/**
 * Foundation test suite: schema, crypto, blind indexes, audit guard, rate
 * limiter fallback. Runs against in-process Postgres (PGlite) with ephemeral
 * keys, so it needs no services and no secrets.
 *   npm run verify
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import * as schema from "../lib/db/schema";
import { setDb, type Database } from "../lib/db";

let failures = 0;
let checks = 0;
function check(label: string, actual: unknown, expected: unknown) {
  checks += 1;
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(
    `${ok ? "  ok  " : "  FAIL"} ${label}${ok ? "" : `\n         expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`}`,
  );
}
async function throws(label: string, fn: () => unknown | Promise<unknown>, pattern?: RegExp) {
  checks += 1;
  try {
    await fn();
    failures += 1;
    console.log(`  FAIL ${label}\n         expected a throw`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (pattern && !pattern.test(msg)) {
      failures += 1;
      console.log(`  FAIL ${label}\n         threw "${msg}", expected ${pattern}`);
    } else console.log(`  ok   ${label}`);
  }
}

async function main() {
  // Ephemeral keys, injected before any crypto import runs.
  const { randomBytes } = await import("node:crypto");
  process.env.PII_ENCRYPTION_KEYS = JSON.stringify({
    k1: randomBytes(32).toString("base64"),
    k2: randomBytes(32).toString("base64"),
  });
  process.env.PII_ENCRYPTION_ACTIVE_KEY_ID = "k1";
  process.env.PII_INDEX_KEY = randomBytes(32).toString("base64");
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;

  const client = new PGlite();
  const db = drizzle(client, { schema });
  setDb(db as unknown as Database);

  const dir = join(process.cwd(), "drizzle");
  const file = readdirSync(dir).filter((f) => f.endsWith(".sql") && f !== "grants.sql").sort()[0]!;
  for (const stmt of readFileSync(join(dir, file), "utf8").split("--> statement-breakpoint")) {
    if (stmt.trim()) await client.exec(stmt.trim());
  }
  console.log(`\nSchema applied from ${file}`);
  const tables = await client.query<{ n: string }>(
    "select table_name as n from information_schema.tables where table_schema='public' order by 1",
  );
  check("all 16 tables created", tables.rows.length, 16);

  // ------------------------------------------------------------ crypto
  console.log("\nEncryption");
  const c = await import("../lib/crypto");

  const env = c.encryptField("sarah@example.com", c.CTX.donorEmail);
  check("envelope has 4 parts", env.split(".").length, 4);
  check("envelope names active key", env.split(".")[1], "k1");
  check("roundtrip", c.decryptField(env, c.CTX.donorEmail), "sarah@example.com");
  check("two encryptions differ (random IV)", c.encryptField("x", c.CTX.donorName) === c.encryptField("x", c.CTX.donorName), false);

  await throws("wrong column context is rejected (AAD)", () => c.decryptField(env, c.CTX.contactEmail));
  const flipped = env.slice(0, -2) + (env.endsWith("A") ? "B" : "A") + env.slice(-1);
  await throws("bit flip is rejected (GCM tag)", () => c.decryptField(flipped, c.CTX.donorEmail));
  await throws("malformed envelope is rejected", () => c.decryptField("garbage", c.CTX.donorEmail), /Malformed/);
  await throws("unknown key id is rejected", () => c.decryptField(env.replace(".k1.", ".k9."), c.CTX.donorEmail), /Unknown/);

  // Rotation: old ciphertext under k1 still decrypts after k2 becomes active.
  process.env.PII_ENCRYPTION_ACTIVE_KEY_ID = "k2";
  c.setKeyProvider(new c.EnvKeyProvider());
  check("old key still decrypts after rotation", c.decryptField(env, c.CTX.donorEmail), "sarah@example.com");
  check("new writes use new key", c.encryptField("y", c.CTX.donorName).split(".")[1], "k2");
  check("encryptOptional('') is null", c.encryptOptional("  ", c.CTX.donorName), null);
  check("unicode roundtrip", c.decryptField(c.encryptField("Zoë Müller 🏒", c.CTX.donorName), c.CTX.donorName), "Zoë Müller 🏒");

  console.log("\nBlind indexes");
  check("email index is case/space insensitive", c.blindIndex("email", "  Sarah@Example.COM "), c.blindIndex("email", "sarah@example.com"));
  check("different emails differ", c.blindIndex("email", "a@x.com") === c.blindIndex("email", "b@x.com"), false);
  check("phone: 10 digits → +1", c.normalizePhone("(919) 555-0199"), "+19195550199");
  check("phone: 11 digits leading 1", c.normalizePhone("1-919-555-0199"), "+19195550199");
  check("phone index normalizes formats", c.blindIndex("phone", "919.555.0199"), c.blindIndex("phone", "+1 (919) 555-0199"));
  check("index is 64 hex chars", /^[0-9a-f]{64}$/.test(c.blindIndex("email", "a@b.c")), true);
  check("ip hash rotates monthly", c.hashIp("1.2.3.4", new Date("2026-09-01")) === c.hashIp("1.2.3.4", new Date("2026-10-01")), false);
  check("ip hash stable within month", c.hashIp("1.2.3.4", new Date("2026-09-01")), c.hashIp("1.2.3.4", new Date("2026-09-28")));
  check("ip hash is not the ip", c.hashIp("1.2.3.4").includes("1.2.3.4"), false);

  await throws("missing keys fail closed", () => new c.EnvKeyProvider({}), /keys:generate/);
  await throws("short key rejected", () => new c.EnvKeyProvider({
    PII_ENCRYPTION_KEYS: JSON.stringify({ k1: Buffer.alloc(16).toString("base64") }),
    PII_ENCRYPTION_ACTIVE_KEY_ID: "k1",
    PII_INDEX_KEY: randomBytes(32).toString("base64"),
  }), /32 bytes/);

  // ------------------------------------------------------------ audit guard
  console.log("\nAudit log");
  const { audit } = await import("../lib/audit");
  const [org] = await db.insert(schema.organizations).values({ slug: "t", name: "Test Org" }).returning();
  const [user] = await db.insert(schema.users).values({ clerkUserId: "user_1", email: "coach@test.edu" }).returning();

  await audit({ action: "campaign.create", targetType: "campaign", targetId: "abc", orgId: org!.id, actorUserId: user!.id, ip: "9.9.9.9", metadata: { goal_cents: 100000, participant_count: 0 } });
  const [row] = await db.select().from(schema.auditLogs);
  check("audit row written", row?.action, "campaign.create");
  check("audit ip is hashed", row?.actorIpHash?.includes("9.9.9.9"), false);
  await throws("audit rejects email key", () => audit({ action: "donation.export", targetType: "x", metadata: { donor_email: "a@b.c" } }), /PII/);
  await throws("audit rejects name key", () => audit({ action: "donation.export", targetType: "x", metadata: { campaign_name: "x" } }), /PII/);
  await throws("audit rejects long values", () => audit({ action: "donation.export", targetType: "x", metadata: { note_id: "x".repeat(201) } }));

  // ------------------------------------------------------------ rate limiter
  console.log("\nRate limiter");
  const { limiters } = await import("../lib/ratelimit");
  let ok = 0, denied = 0;
  for (let i = 0; i < 12; i++) {
    if ((await limiters.checkout.limit("ip-test")).success) ok++;
    else denied++;
  }
  check("checkout allows 8 then denies", [ok, denied], [8, 4]);
  check("separate identifiers are independent", (await limiters.checkout.limit("ip-other")).success, true);

  // ------------------------------------------------------------ schema constraints
  console.log("\nSchema constraints");
  const [camp] = await db.insert(schema.campaigns).values({ orgId: org!.id, slug: "s", name: "S", joinCode: "JOIN1", createdBy: user!.id }).returning();
  await throws("duplicate campaign slug per org rejected", () => db.insert(schema.campaigns).values({ orgId: org!.id, slug: "s", name: "S2", joinCode: "JOIN2" }));
  const [p] = await db.insert(schema.participants).values({ campaignId: camp!.id, userId: user!.id, slug: "p", displayName: "P" }).returning();
  await throws("one participant row per user per campaign", () => db.insert(schema.participants).values({ campaignId: camp!.id, userId: user!.id, slug: "p2", displayName: "P" }));

  const idx = c.blindIndex("email", "aunt@x.com");
  await db.insert(schema.contacts).values({ participantId: p!.id, nameCiphertext: c.encryptField("Aunt", c.CTX.contactName), emailCiphertext: c.encryptField("aunt@x.com", c.CTX.contactEmail), emailBlindIndex: idx });
  await throws("duplicate contact email per participant rejected", () => db.insert(schema.contacts).values({ participantId: p!.id, nameCiphertext: "x", emailBlindIndex: idx }));
  await db.insert(schema.contacts).values({ participantId: p!.id, nameCiphertext: "x", phoneCiphertext: "y", phoneBlindIndex: c.blindIndex("phone", "9195550100") });
  await db.insert(schema.contacts).values({ participantId: p!.id, nameCiphertext: "x", phoneCiphertext: "y", phoneBlindIndex: c.blindIndex("phone", "9195550101") });
  check("phone-only contacts (null email index) coexist", (await db.select().from(schema.contacts).where(eq(schema.contacts.participantId, p!.id))).length, 3);

  await db.insert(schema.webhookEvents).values({ provider: "stripe", eventId: "evt_1", type: "t" });
  const dup = await db.insert(schema.webhookEvents).values({ provider: "stripe", eventId: "evt_1", type: "t" }).onConflictDoNothing().returning();
  check("webhook replay is a no-op", dup.length, 0);
  const cross = await db.insert(schema.webhookEvents).values({ provider: "clerk", eventId: "evt_1", type: "t" }).onConflictDoNothing().returning();
  check("same event id across providers is distinct", cross.length, 1);

  // ------------------------------------------------------------ build safety
  console.log("\nBuild safety (no secrets at import time)");
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.VERCEL_ENV;
  delete process.env.APP_ENV;
  const stripeMod = await import("../lib/stripe");
  check("importing lib/stripe needs no key", typeof stripeMod.getStripe, "function");
  await throws("getStripe fails closed without a key", () => stripeMod.getStripe(), /not set/);
  process.env.STRIPE_SECRET_KEY = "sk_test_x";
  await throws("unrestricted sk_ key is refused everywhere", () => stripeMod.getStripe(), /RESTRICTED/);
  process.env.STRIPE_SECRET_KEY = "rk_test_x";
  process.env.VERCEL_ENV = "production";
  await throws("test key refused in a production deploy", () => stripeMod.getStripe(), /live/);
  delete process.env.VERCEL_ENV;
  check("restricted test key accepted outside production", Boolean(stripeMod.getStripe()), true);

  // ------------------------------------------------------------ campaign queries
  console.log("\nCampaign queries");
  const q = await import("../lib/queries/campaigns");
  const pq = await import("../lib/queries/participants");

  check("uniqueCampaignSlug takes the base when free", await q.uniqueCampaignSlug(org!.id, "Spring Fund"), "spring-fund");
  const [active] = await db.insert(schema.campaigns).values({ orgId: org!.id, slug: "spring-fund", name: "Spring Fund", joinCode: "JOINA1", status: "active", goalCents: 500000 }).returning();
  check("uniqueCampaignSlug suffixes on collision", await q.uniqueCampaignSlug(org!.id, "Spring Fund"), "spring-fund-2");
  await db.insert(schema.campaigns).values({ orgId: org!.id, slug: "old", name: "Old", joinCode: "JOINC1", status: "closed" });
  // `camp` from above is a draft.

  const all = await q.listCampaignsForOrg(org!.id);
  check("admin listing sees every status", all.length, 3);
  const pub = await q.listPublicCampaigns(org!.id);
  check("public listing hides drafts", pub.map((c) => c.status).sort(), ["active", "closed"]);
  check("public listing puts active first", pub[0]!.status, "active");
  check("draft slug is invisible publicly", await q.getPublicCampaignBySlug(org!.id, "s"), null);
  check("active slug resolves publicly", (await q.getPublicCampaignBySlug(org!.id, "spring-fund"))?.id, active!.id);

  const [u2] = await db.insert(schema.users).values({ clerkUserId: "user_2", email: "p2@test.edu" }).returning();
  const [pa] = await db.insert(schema.participants).values({ campaignId: active!.id, userId: user!.id, slug: "a", displayName: "A", goalCents: 50000 }).returning();
  await db.insert(schema.participants).values({ campaignId: active!.id, userId: u2!.id, slug: "gone", displayName: "Gone", status: "removed" });
  await db.insert(schema.donations).values([
    { campaignId: active!.id, participantId: pa!.id, grossAmountCents: 10256, designatedAmountCents: 10000, feeCoveredCents: 256, status: "succeeded" },
    { campaignId: active!.id, participantId: pa!.id, grossAmountCents: 5000, designatedAmountCents: 5000, status: "pending" },
    { campaignId: active!.id, participantId: null, grossAmountCents: 2500, designatedAmountCents: 2500, status: "succeeded" },
    { campaignId: active!.id, participantId: pa!.id, grossAmountCents: 7777, designatedAmountCents: 7777, status: "refunded" },
  ]);

  const totals = (await q.getCampaignWithTotals(active!.id))!;
  check("raised counts designated amount of succeeded only", totals.raisedCents, 12500);
  check("raised excludes fee-cover (goes to Stripe, not the goal)", totals.raisedCents < 12756, true);
  check("donor count counts succeeded only", totals.donorCount, 2);
  check("participant count excludes removed", totals.participantCount, 1);

  const board = await pq.listParticipantsWithTotals(active!.id);
  check("leaderboard excludes removed participants", board.map((r) => r.slug), ["a"]);
  check("leaderboard per-participant total", board[0]!.raisedCents, 10000);
  check("leaderboard exposes no PII fields", Object.keys(board[0]!).some((k) => /email|phone|user/i.test(k)), false);
  check("participant lookup ignores removed", await pq.getParticipantBySlug(active!.id, "gone"), null);
  check("my participations lists active only", (await pq.listMyParticipations(u2!.id)).length, 0);

  console.log(`\n${failures === 0 ? "PASS" : "FAIL"} — ${checks - failures}/${checks} checks passed\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
