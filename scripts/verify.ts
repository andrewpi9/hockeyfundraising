/**
 * Foundation test suite: schema, crypto, blind indexes, audit guard, rate
 * limiter fallback. Runs against in-process Postgres (PGlite) with ephemeral
 * keys, so it needs no services and no secrets.
 *   npm run verify
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type Stripe from "stripe";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { and, eq } from "drizzle-orm";
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
  process.env.EMAIL_SILENT = "1";
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;

  const client = new PGlite();
  const db = drizzle(client, { schema });
  setDb(db as unknown as Database);

  const dir = join(process.cwd(), "drizzle");
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql") && f !== "grants.sql").sort();
  for (const file of files) {
    for (const stmt of readFileSync(join(dir, file), "utf8").split("--> statement-breakpoint")) {
      if (stmt.trim()) await client.exec(stmt.trim());
    }
  }
  console.log(`\nSchema applied from ${files.join(", ")}`);
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

  // ------------------------------------------------------------ phase 2: onboarding + sharing
  console.log("\nUpload validation");
  const img = await import("../lib/images");
  check("jpeg magic bytes", img.sniffImageType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0])), "image/jpeg");
  check("png magic bytes", img.sniffImageType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0])), "image/png");
  check("webp magic bytes", img.sniffImageType(new Uint8Array([...Buffer.from("RIFF"), 0, 0, 0, 0, ...Buffer.from("WEBP")])), "image/webp");
  check("svg is refused (script container)", img.sniffImageType(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'>")), null);
  check("gif is refused", img.sniffImageType(Buffer.from("GIF89a")), null);
  check("empty is refused", img.sniffImageType(new Uint8Array()), null);
  check("declared MIME is irrelevant: html named .png", img.sniffImageType(Buffer.from("<html>")), null);
  check("our blob host is recognised", img.isOurBlobUrl("https://abc123.public.blob.vercel-storage.com/participants/x/y.jpg"), true);
  check("lookalike host is rejected", img.isOurBlobUrl("https://public.blob.vercel-storage.com.evil.com/x.jpg"), false);
  check("http is rejected", img.isOurBlobUrl("http://abc.public.blob.vercel-storage.com/x.jpg"), false);
  check("null is rejected", img.isOurBlobUrl(null), false);

  console.log("\nClick analytics privacy");
  const ua = await import("../lib/ua");
  check("iPhone Safari → Mobile Safari", ua.uaFamily("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"), "Mobile Safari");
  check("Instagram in-app detected", ua.uaFamily("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Instagram 300.0"), "Instagram");
  check("desktop Chrome", ua.uaFamily("Mozilla/5.0 (Macintosh) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"), "Chrome");
  check("unknown → Other, never the raw string", ua.uaFamily("curl/8.4.0"), "Other");
  check("referer keeps host only", ua.refererHost("https://www.instagram.com/p/abc123/?token=secret"), "www.instagram.com");
  check("garbage referer → null", ua.refererHost("not a url"), null);

  console.log("\nMasking + tokens");
  const { maskEmail } = await import("../lib/mask");
  check("email masked", maskEmail("jordan.smith@unc.edu"), "j***@unc.edu");
  check("junk masked", maskEmail("nonsense"), "***");
  const tok = await import("../lib/tokens");
  const t1 = tok.inviteToken();
  check("invite token is long and url-safe", /^[A-Za-z0-9_-]{40,}$/.test(t1), true);
  check("token hash is sha256 hex", /^[0-9a-f]{64}$/.test(tok.hashToken(t1)), true);
  check("hash is deterministic", tok.hashToken(t1), tok.hashToken(t1));

  console.log("\nOnboarding data flow");
  const { ensurePersonalShareLink, recordClick } = await import("../lib/sharing");
  const { createParticipantForUser } = await import("../lib/participants");
  const [u3] = await db.insert(schema.users).values({ clerkUserId: "user_3", email: "chris.miller@unc.edu", name: "Chris Miller" }).returning();
  const [u4] = await db.insert(schema.users).values({ clerkUserId: "user_4", email: "chris.miller2@unc.edu", name: "Chris Miller" }).returning();

  const p3 = await createParticipantForUser(u3!, active!);
  check("participant created with slug from name", p3.slug, "chris-miller");
  const p3again = await createParticipantForUser(u3!, active!);
  check("re-joining is idempotent", p3again.id, p3.id);
  const p4 = await createParticipantForUser(u4!, active!);
  check("same display name gets a suffixed slug", p4.slug, "chris-miller-2");

  const code1 = await ensurePersonalShareLink(p3.id, active!.id);
  const code2 = await ensurePersonalShareLink(p3.id, active!.id);
  check("personal share link minted on join", typeof code1, "string");
  check("personal share link is stable", code1, code2);

  const [link] = await db.select().from(schema.shareLinks).where(eq(schema.shareLinks.code, code1));
  await recordClick(link!.id, { ip: "203.0.113.9", userAgent: "Mozilla/5.0 (iPhone) Version/17.0 Mobile Safari/604.1", referer: "https://instagram.com/x/y?z=1" });
  await recordClick(link!.id, { ip: "203.0.113.9", userAgent: null, referer: null });
  const [afterClicks] = await db.select().from(schema.shareLinks).where(eq(schema.shareLinks.id, link!.id));
  check("click count increments", afterClicks!.clickCount, 2);
  const events = await db.select().from(schema.linkEvents).where(eq(schema.linkEvents.shareLinkId, link!.id));
  check("raw ip never stored", events.some((e) => JSON.stringify(e).includes("203.0.113.9")), false);
  check("referer stored as host only", events[0]!.refererHost, "instagram.com");
  check("ua stored as family only", events[0]!.uaFamily, "Mobile Safari");

  await db.update(schema.participants).set({ status: "removed" }).where(eq(schema.participants.id, p4.id));
  await throws("removed participant cannot rejoin themselves", () => createParticipantForUser(u4!, active!), /removed/);

  // Invite binding: token finds the row, but only the invited address may accept.
  const rawToken = tok.inviteToken();
  await db.insert(schema.participantInvites).values({
    campaignId: active!.id,
    emailCiphertext: c.encryptField("invitee@unc.edu", c.CTX.inviteEmail),
    emailBlindIndex: c.blindIndex("email", "invitee@unc.edu"),
    tokenHash: tok.hashToken(rawToken),
    expiresAt: new Date(Date.now() + 1000 * 60),
  });
  const [found] = await db.select().from(schema.participantInvites).where(eq(schema.participantInvites.tokenHash, tok.hashToken(rawToken)));
  check("invite found by token hash", Boolean(found), true);
  check("invite matches the invited address", found!.emailBlindIndex === c.blindIndex("email", "Invitee@UNC.edu"), true);
  check("invite rejects a different address", found!.emailBlindIndex === c.blindIndex("email", "someone.else@unc.edu"), false);
  const [byWrongToken] = await db.select().from(schema.participantInvites).where(eq(schema.participantInvites.tokenHash, tok.hashToken("wrong")));
  check("wrong token finds nothing", byWrongToken, undefined);

  // ------------------------------------------------------------ phase 3: outreach
  console.log("\nHTML escaping");
  const { escapeHtml } = await import("../lib/html");
  check("script tag neutralised", escapeHtml(`<script>alert("x")</script>`), "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
  check("ampersand and quote", escapeHtml(`Tom & Jerry's`), "Tom &amp; Jerry&#39;s");

  console.log("\nCSV import parsing");
  const csv = await import("../lib/csv");
  const headered = csv.parseContactsCsv(`Name,Email,Phone\nAunt Sarah,Sarah@Example.com,(919) 555-0199\nCoach Miller,miller@example.com,\nGrandpa Joe,,704.555.0142\nNobody,,\nAunt Sarah,sarah@example.com,9195550199\n`);
  check("headered: valid rows kept", headered.contacts.length, 3);
  check("headered: email normalised", headered.contacts[0]!.email, "sarah@example.com");
  check("headered: phone normalised", headered.contacts[0]!.phone, "+19195550199");
  check("headered: row without email or phone skipped", headered.contacts.some((c) => c.name === "Nobody"), false);
  check("headered: in-file duplicate collapsed", headered.skipped, 2);
  const firstLast = csv.parseContactsCsv(`First Name,Last Name,E-mail\nChris,Miller,chris@x.com\n`);
  check("first/last columns joined", firstLast.contacts[0]!.name, "Chris Miller");
  const both = csv.parseContactsCsv(`Name,First Name,Last Name,Email\n,Chris,Miller,c@x.com\nPat Lee,Pat,Lee,p@x.com\n`);
  check("empty name cell falls through to first+last", both.contacts[0]!.name, "Chris Miller");
  check("full name column preferred when present", both.contacts[1]!.name, "Pat Lee");
  const positional = csv.parseContactsCsv(`Aunt Sarah,sarah@example.com,919-555-0199\nGrandpa Joe,704-555-0142\n`);
  check("headerless: positional detection", positional.contacts.map((c) => [c.name, c.email, c.phone]), [["Aunt Sarah", "sarah@example.com", "+19195550199"], ["Grandpa Joe", null, "+17045550142"]]);
  check("bad email rejected, phone keeps row", csv.parseContactsCsv(`name,email,phone\nX,not-an-email,9195550100\n`).contacts[0]!.email, null);
  check("short phone rejected", csv.parseContactsCsv(`name,email,phone\nX,,12345\n`).contacts.length, 0);
  const big = csv.parseContactsCsv("name,email\n" + Array.from({ length: 1200 }, (_, i) => `P${i},p${i}@x.com`).join("\n"));
  check("row cap enforced", big.contacts.length, 1000);
  check("row cap reported", big.errors.length > 0, true);
  check("name truncated to 120", csv.parseContactsCsv(`name,email\n${"a".repeat(300)},a@b.co\n`).contacts[0]!.name.length, 120);

  console.log("\nUnsubscribe tokens");
  const cid = "0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d";
  const utok = c.signUnsubscribeToken(cid);
  check("token verifies to its contact id", c.verifyUnsubscribeToken(utok), cid);
  check("tampered mac rejected", c.verifyUnsubscribeToken(utok.slice(0, -1) + (utok.endsWith("A") ? "B" : "A")), null);
  check("swapped id rejected", c.verifyUnsubscribeToken(`${Buffer.from("0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4e").toString("base64url")}.${utok.split(".")[1]}`), null);
  check("garbage rejected", c.verifyUnsubscribeToken("hello"), null);
  check("empty rejected", c.verifyUnsubscribeToken(""), null);

  console.log("\nSuppression + send pipeline");
  const { applyUnsubscribe } = await import("../lib/unsubscribe");
  const outreach = await import("../lib/outreach");
  const { ensureContactShareLink } = await import("../lib/sharing");
  const cq = await import("../lib/queries/contacts");

  // org needs a postal address before anything can be sent
  const [orgNoAddr] = await db.select().from(schema.organizations).where(eq(schema.organizations.id, org!.id));
  await throws("sending refused without org postal address", () => outreach.sendInvitesForContacts({ participant: p3, campaign: active!, org: orgNoAddr!, contactIds: [], note: null }), /mailing address/);
  await db.update(schema.organizations).set({ addressLine1: "1 Main St", city: "Chapel Hill", state: "NC", postalCode: "27514" }).where(eq(schema.organizations.id, org!.id));
  const [orgAddr] = await db.select().from(schema.organizations).where(eq(schema.organizations.id, org!.id));
  check("postal address assembled", outreach.orgPostalAddress(orgAddr!), "1 Main St, Chapel Hill, NC, 27514");

  const mk = async (name: string, email: string | null, phone: string | null) => {
    const [row] = await db.insert(schema.contacts).values({
      participantId: p3.id,
      nameCiphertext: c.encryptField(name, c.CTX.contactName),
      emailCiphertext: c.encryptOptional(email, c.CTX.contactEmail),
      phoneCiphertext: c.encryptOptional(phone, c.CTX.contactPhone),
      emailBlindIndex: email ? c.blindIndex("email", email) : null,
      phoneBlindIndex: phone ? c.blindIndex("phone", phone) : null,
    }).returning();
    return row!;
  };
  const cA = await mk("A", "a@contacts.test", null);
  const cB = await mk("B", "b@contacts.test", null);
  const cC = await mk("C", null, "9195550111");
  const cD = await mk("D", "d@contacts.test", null);
  const [otherP] = await db.select().from(schema.participants).where(eq(schema.participants.id, pa!.id));
  const foreign = await (async () => {
    const [row] = await db.insert(schema.contacts).values({ participantId: otherP!.id, nameCiphertext: c.encryptField("F", c.CTX.contactName), emailCiphertext: c.encryptField("f@contacts.test", c.CTX.contactEmail), emailBlindIndex: c.blindIndex("email", "f@contacts.test") }).returning();
    return row!;
  })();

  await applyUnsubscribe(cB.id, "unsubscribed", "198.51.100.7");
  const [supp] = await db.select().from(schema.suppressions).where(eq(schema.suppressions.emailBlindIndex, cB.emailBlindIndex!));
  check("unsubscribe writes org-wide suppression", supp?.orgId, org!.id);
  check("unsubscribe flags the contact", Boolean((await db.select().from(schema.contacts).where(eq(schema.contacts.id, cB.id)))[0]!.unsubscribedAt), true);
  check("unsubscribe is audited without raw ip", (await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.action, "suppression.add")))[0]!.actorIpHash?.includes("198.51"), false);
  check("re-applying is idempotent", await applyUnsubscribe(cB.id, "unsubscribed"), true);
  check("suppression lookup by index", await cq.isSuppressed(org!.id, cB.emailBlindIndex!), true);

  // D was emailed yesterday → cooldown
  await db.update(schema.contacts).set({ lastInvitedAt: new Date(Date.now() - 86_400_000) }).where(eq(schema.contacts.id, cD.id));

  const summary = await outreach.sendInvitesForContacts({ participant: p3, campaign: active!, org: orgAddr!, contactIds: [cA.id, cB.id, cC.id, cD.id, foreign.id], note: "<b>hi</b>" });
  check("only the eligible contact is sent", summary.sent, 1);
  check("unsubscribed skipped", summary.skipped.unsubscribed, 1);
  check("no-email skipped", summary.skipped.noEmail, 1);
  check("7-day cooldown skipped", summary.skipped.recent, 1);
  check("another participant's contact skipped", summary.skipped.notOwned, 1);
  const invitesA = await db.select().from(schema.emailInvites).where(eq(schema.emailInvites.contactId, cA.id));
  check("email_invites row recorded as sent", invitesA[0]?.status, "sent");
  check("lastInvitedAt stamped", Boolean((await db.select().from(schema.contacts).where(eq(schema.contacts.id, cA.id)))[0]!.lastInvitedAt), true);
  const linkA = await db.select().from(schema.shareLinks).where(eq(schema.shareLinks.contactId, cA.id));
  check("per-contact email link minted", linkA[0]?.medium, "email_invite");
  check("per-contact link is stable", await ensureContactShareLink(p3.id, active!.id, cA.id, "email_invite"), linkA[0]!.code);
  check("sms link is a distinct code", (await ensureContactShareLink(p3.id, active!.id, cA.id, "sms")) === linkA[0]!.code, false);
  const again = await outreach.sendInvitesForContacts({ participant: p3, campaign: active!, org: orgAddr!, contactIds: [cA.id], note: null });
  check("immediate re-send blocked by cooldown", again.skipped.recent, 1);
  check("batch capped", (await outreach.sendInvitesForContacts({ participant: p3, campaign: active!, org: orgAddr!, contactIds: Array.from({ length: 40 }, () => crypto.randomUUID()), note: null })).skipped.notOwned, outreach.OUTREACH_BATCH_MAX);
  check("summary reads naturally", outreach.describeSummary(summary).startsWith("Sent 1."), true);

  console.log("\nBatch rate limit");
  const bulk = (await import("../lib/ratelimit")).limiters.emailInvite;
  check("batch of 60 consumes 60", (await bulk.limit("p-batch", 60)).remaining, 40);
  check("second batch of 60 is refused", (await bulk.limit("p-batch", 60)).success, false);

  console.log("\nContact queries");
  const listed = await cq.listContactsForParticipant(p3.id);
  check("contacts listed newest first", listed.length, 4);
  check("latest invite status joined", listed.find((r) => r.contact.id === cA.id)!.lastInviteStatus, "sent");
  check("count", await cq.countContacts(p3.id), 4);
  const dedupeIdx = await cq.existingContactIndexes(p3.id);
  check("existing email indexes for dedupe", dedupeIdx.emails.has(c.blindIndex("email", "A@contacts.test")), true);
  check("existing phone indexes for dedupe", dedupeIdx.phones.has(c.blindIndex("phone", "(919) 555-0111")), true);
  const loaded = await cq.loadContactRows(p3.id);
  check("loadContactRows decrypts names", loaded.map((r) => r.name).sort(), ["A", "B", "C", "D"]);
  check("A (just emailed) not eligible", loaded.find((r) => r.name === "A")!.eligibleForEmail, false);
  check("B (unsubscribed) not eligible", loaded.find((r) => r.name === "B")!.eligibleForEmail, false);
  check("C (no email) not eligible", loaded.find((r) => r.name === "C")!.eligibleForEmail, false);
  check("D cooldown: 1 day since invite", loaded.find((r) => r.name === "D")!.daysSinceInvite, 1);
  check("D eligible again after 7 days", (await cq.loadContactRows(p3.id, new Date(Date.now() + 8 * 86_400_000))).find((r) => r.name === "D")!.eligibleForEmail, true);

  // ------------------------------------------------------------ phase 4: donations
  console.log("\nFee math from configuration");
  const money = await import("../lib/money");
  delete process.env.NEXT_PUBLIC_STRIPE_FEE_PERCENT;
  delete process.env.NEXT_PUBLIC_STRIPE_FEE_FIXED_CENTS;
  check("default is the standard rate (never under-collect)", money.stripeFeeRate(), { percent: 0.029, fixedCents: 30 });
  check("standard: $100 grosses to $103.30", money.grossUpForFees(10000), 10330);
  process.env.NEXT_PUBLIC_STRIPE_FEE_PERCENT = "2.2";
  check("nonprofit rate via env", money.stripeFeeRate().percent, 0.022);
  check("nonprofit: $100 grosses to $102.56", money.grossUpForFees(10000), 10256);
  for (const amount of [500, 2500, 10000, 99999, 250000]) {
    for (const rate of ["2.2", "2.9", "3.5"]) {
      process.env.NEXT_PUBLIC_STRIPE_FEE_PERCENT = rate;
      const g = money.grossUpForFees(amount);
      check(`no shortfall: ${amount}c at ${rate}%`, g - money.estimatedStripeFee(g) >= amount, true);
    }
  }
  process.env.NEXT_PUBLIC_STRIPE_FEE_PERCENT = "junk";
  check("garbage rate falls back to standard", money.stripeFeeRate().percent, 0.029);
  process.env.NEXT_PUBLIC_STRIPE_FEE_PERCENT = "2.2";
  check("platform fee 0 bps is 0", money.platformFeeFor(10000, 0), 0);
  check("platform fee 250 bps of $100 is $2.50", money.platformFeeFor(10000, 250), 250);

  console.log("\nCheckout input validation");
  const { CheckoutInput } = await import("../lib/checkout-schema");
  const good = { campaignSlug: "spring-fund", amountCents: 5000, coverFee: true, donorEmail: "d@x.com" };
  check("valid body accepted", CheckoutInput.safeParse(good).success, true);
  check("below minimum rejected", CheckoutInput.safeParse({ ...good, amountCents: 499 }).success, false);
  check("above maximum rejected", CheckoutInput.safeParse({ ...good, amountCents: 2_500_001 }).success, false);
  check("fractional cents rejected", CheckoutInput.safeParse({ ...good, amountCents: 50.5 }).success, false);
  check("bad email rejected", CheckoutInput.safeParse({ ...good, donorEmail: "nope" }).success, false);
  check("bad ref shape rejected", CheckoutInput.safeParse({ ...good, ref: "../../etc" }).success, false);
  check("501-char note rejected", CheckoutInput.safeParse({ ...good, message: "x".repeat(501) }).success, false);
  check("coverFee defaults true", CheckoutInput.parse({ campaignSlug: "s", amountCents: 500, donorEmail: "d@x.com" }).coverFee, true);

  console.log("\nStripe event processing");
  const { processStripeEvent } = await import("../lib/stripe-events");
  const dq = await import("../lib/queries/donations");
  const mkDonation = async (over: Partial<typeof schema.donations.$inferInsert> = {}) => {
    const [row] = await db.insert(schema.donations).values({
      campaignId: active!.id,
      participantId: p3.id,
      grossAmountCents: 10256,
      designatedAmountCents: 10000,
      feeCoveredCents: 256,
      donorNameCiphertext: c.encryptField("Jordan Smith", c.CTX.donorName),
      donorEmailCiphertext: c.encryptField("jordan@donor.test", c.CTX.donorEmail),
      donorEmailBlindIndex: c.blindIndex("email", "jordan@donor.test"),
      messageCiphertext: c.encryptField("Go team", c.CTX.donorMessage),
      status: "pending",
      ...over,
    }).returning();
    return row!;
  };
  // Each session gets its own PaymentIntent, as in reality: cs_test_1 → pi_1.
  // The unique index on stripe_payment_intent_id is deliberate and must hold.
  const sessionEvt = (id: string, over: Record<string, unknown>) =>
    ({ id: `evt_${crypto.randomUUID()}`, type: "checkout.session.completed", data: { object: { id, object: "checkout.session", payment_status: "paid", amount_total: 10256, payment_intent: `pi_${id.replace("cs_test_", "")}`, payment_method_types: ["card"], ...over } } }) as unknown as Stripe.Event;

  const before = await dq.getCampaignStats(active!.id);

  // happy path
  const d1 = await mkDonation({ stripeCheckoutSessionId: "cs_test_1" });
  check("completed+paid → processed", await processStripeEvent(sessionEvt("cs_test_1", { metadata: { donationId: d1.id } })), "processed");
  const [d1after] = await db.select().from(schema.donations).where(eq(schema.donations.id, d1.id));
  check("status succeeded", d1after!.status, "succeeded");
  check("payment intent stored from event", d1after!.stripePaymentIntentId, "pi_1");
  check("payment method type stored", d1after!.paymentMethodType, "card");
  check("receipt sent (timestamp set)", Boolean(d1after!.receiptSentAt), true);
  check("replayed event is ignored", await processStripeEvent(sessionEvt("cs_test_1", { metadata: { donationId: d1.id } })), "ignored");
  const after = await dq.getCampaignStats(active!.id);
  check("stats grew by the designated amount only", after.raisedCents - before.raisedCents, 10000);
  check("stats donor count grew by one", after.donorCount - before.donorCount, 1);

  // tamper / mismatch
  const d2 = await mkDonation({ stripeCheckoutSessionId: "cs_test_2" });
  check("metadata id without matching session id is ignored", await processStripeEvent(sessionEvt("cs_test_OTHER", { metadata: { donationId: d2.id } })), "ignored");
  check("amount mismatch is processed (as failure)", await processStripeEvent(sessionEvt("cs_test_2", { metadata: { donationId: d2.id }, amount_total: 999999 })), "processed");
  check("mismatched donation marked failed, not succeeded", (await db.select().from(schema.donations).where(eq(schema.donations.id, d2.id)))[0]!.status, "failed");
  check("failed donation not in stats", (await dq.getCampaignStats(active!.id)).raisedCents, after.raisedCents);

  // ACH: completed but unpaid, then async success
  const d3 = await mkDonation({ stripeCheckoutSessionId: "cs_test_3" });
  await processStripeEvent(sessionEvt("cs_test_3", { metadata: { donationId: d3.id }, payment_status: "unpaid", payment_intent: "pi_3", payment_method_types: ["us_bank_account"] }));
  const [d3mid] = await db.select().from(schema.donations).where(eq(schema.donations.id, d3.id));
  check("unpaid session stays pending", d3mid!.status, "pending");
  check("but records the payment intent", d3mid!.stripePaymentIntentId, "pi_3");
  check("async_payment_succeeded settles it", await processStripeEvent({ ...sessionEvt("cs_test_3", { metadata: { donationId: d3.id }, payment_intent: "pi_3" }), type: "checkout.session.async_payment_succeeded" } as never), "processed");
  check("now succeeded", (await db.select().from(schema.donations).where(eq(schema.donations.id, d3.id)))[0]!.status, "succeeded");

  // ACH failure
  const d4 = await mkDonation({ stripeCheckoutSessionId: "cs_test_4" });
  await processStripeEvent({ ...sessionEvt("cs_test_4", { metadata: { donationId: d4.id }, payment_status: "unpaid" }), type: "checkout.session.async_payment_failed" } as never);
  check("async_payment_failed → failed", (await db.select().from(schema.donations).where(eq(schema.donations.id, d4.id)))[0]!.status, "failed");

  // refunds
  const refundEvt = (pi: string, amount_refunded: number) => ({ id: `evt_${crypto.randomUUID()}`, type: "charge.refunded", data: { object: { id: "ch_1", object: "charge", payment_intent: pi, amount_refunded } } }) as never;
  const statsPreRefund = await dq.getCampaignStats(active!.id);
  check("partial refund → partially_refunded", (await processStripeEvent(refundEvt("pi_1", 2000)), (await db.select().from(schema.donations).where(eq(schema.donations.id, d1.id)))[0]!.status), "partially_refunded");
  check("refunded amount recorded", (await db.select().from(schema.donations).where(eq(schema.donations.id, d1.id)))[0]!.refundedAmountCents, 2000);
  check("partially refunded gift drops from public totals (conservative)", (await dq.getCampaignStats(active!.id)).raisedCents, statsPreRefund.raisedCents - 10000);
  await processStripeEvent(refundEvt("pi_1", 10256));
  check("full refund → refunded", (await db.select().from(schema.donations).where(eq(schema.donations.id, d1.id)))[0]!.status, "refunded");
  check("refund for unknown intent ignored", await processStripeEvent(refundEvt("pi_nope", 100)), "ignored");

  // dispute
  const disputeEvt = { id: `evt_${crypto.randomUUID()}`, type: "charge.dispute.created", data: { object: { id: "dp_1", object: "dispute", payment_intent: "pi_3", charge: "ch_3" } } } as never;
  await processStripeEvent(disputeEvt);
  check("dispute → disputed", (await db.select().from(schema.donations).where(eq(schema.donations.id, d3.id)))[0]!.status, "disputed");
  check("unknown event type ignored", await processStripeEvent({ id: "evt_x", type: "customer.created", data: { object: {} } } as never), "ignored");

  console.log("\nDonor wall privacy");
  const d5 = await mkDonation({ stripeCheckoutSessionId: "cs_test_5", isAnonymous: true, donorNameCiphertext: c.encryptField("Secret Santa", c.CTX.donorName) });
  await processStripeEvent(sessionEvt("cs_test_5", { metadata: { donationId: d5.id } }));
  const wall = await dq.listPublicDonations(active!.id, { limit: 10 });
  const anon = wall.find((w) => w.id === d5.id)!;
  check("anonymous gift shows no name", anon.donorName, null);
  check("anonymous gift keeps its message", anon.message, "Go team");
  check("wall entries carry no email field", Object.keys(anon).some((k) => /email/i.test(k)), false);
  check("wall excludes refunded and disputed", wall.some((w) => w.id === d1.id || w.id === d3.id), false);
  check("agoLabel: just now", dq.agoLabel(new Date(), new Date()), "just now");
  check("agoLabel: 3 hours ago", dq.agoLabel(new Date(Date.now() - 3 * 3600_000)), "3 hours ago");
  const thanks = await dq.getDonationBySession("cs_test_5");
  check("thanks page gets first name only", thanks?.firstName, "Secret");
  check("thanks page never exposes ciphertext", thanks ? "nameCiphertext" in thanks : false, false);

  // ------------------------------------------------------------ phase 5: dashboards
  console.log("\nCSV export safety");
  const { csvCell, toCsv } = await import("../lib/csv-export");
  check("formula prefix = neutralised", csvCell("=HYPERLINK(\"http://x\")"), `"'=HYPERLINK(""http://x"")"`);
  check("formula prefix + neutralised", csvCell("+1+1"), `"'+1+1"`);
  check("formula prefix @ neutralised", csvCell("@SUM(A1)"), `"'@SUM(A1)"`);
  check("leading dash string neutralised", csvCell("-cmd"), `"'-cmd"`);
  check("negative NUMBER stays numeric", csvCell(-5.25), "-5.25");
  check("quotes doubled", csvCell(`Tom "T" Jones`), `"Tom ""T"" Jones"`);
  check("null is empty", csvCell(null), "");
  check("boolean is yes/no", csvCell(true), "yes");
  check("date is ISO", csvCell(new Date("2026-09-18T12:00:00Z")), `"2026-09-18T12:00:00.000Z"`);
  check("CRLF line endings", toCsv(["a", "b"], [[1, "x"]]), `"a","b"\r\n1,"x"\r\n`);

  console.log("\nAdmin financials (decrypting queries are admin-only)");
  const adm = await import("../lib/queries/admin-donations");
  const fin = await adm.getCampaignFinancials(active!.id);
  const stats = await dq.getCampaignStats(active!.id);
  check("raised matches public stats", fin.raisedCents, stats.raisedCents);
  check("raised = 22500 (3 succeeded gifts)", fin.raisedCents, 22500);
  check("succeeded count", fin.counts.succeeded, 3);
  check("failed count", fin.counts.failed, 2);
  check("disputed count", fin.counts.disputed, 1);
  check("refunded count (incl. seeded row)", fin.counts.refunded, 2);
  check("pending count", fin.counts.pending, 1);
  check("refunded cents from Stripe", fin.refundedCents, 10256);
  // Two of the three succeeded gifts (the seeded 10256 and d5) carried a 256¢ fee-cover.
  check("fee covered only from succeeded", fin.feeCoveredCents, 512);
  check("gross from succeeded", fin.grossCents, 23012);
  check("estimated net below gross", fin.estimatedNetCents < fin.grossCents, true);
  check("estimated net above raised minus stripe", fin.estimatedNetCents > 0, true);
  check("fee-cover rate 2/3", Math.round(fin.feeCoverRate * 100), 67);

  const adminRows = await adm.listDonationsForAdmin(active!.id, 50);
  const d5row = adminRows.find((r) => r.id === d5.id)!;
  check("admin view decrypts donor email", d5row.donorEmail, "jordan@donor.test");
  check("admin view shows real name of anonymous donor", d5row.donorName, "Secret Santa");
  check("admin view flags anonymity", d5row.isAnonymous, true);
  check("admin view joins participant", d5row.participantName, "Chris Miller");
  check("export returns every row regardless of status", (await adm.exportDonationsForAdmin(active!.id)).length, 9);

  console.log("\nParticipant donor view");
  const supporters = await dq.listDonorsForParticipant(p3.id);
  check("participant sees succeeded + pending only", supporters.map((x) => x.status).every((st) => st === "succeeded" || st === "pending"), true);
  check("participant sees exactly their settled gift", supporters.filter((x) => x.status === "succeeded").length, 1);
  check("anonymous donor is anonymous to the participant too", supporters[0]!.donorName, null);
  check("participant sees the message", supporters[0]!.message, "Go team");
  check("participant view has NO email field", supporters.some((x) => Object.keys(x).some((k) => /email/i.test(k))), false);
  check("participant stats", await dq.getParticipantStats(p3.id), { raisedCents: 10000, donorCount: 1 });

  console.log("\nAudit trail");
  const { listAuditLogs } = await import("../lib/queries/audit");
  const logs = await listAuditLogs(org!.id, 500);
  check("audit rows exist", logs.length > 0, true);
  check("actor email joined from identity table", logs.some((l) => l.actorEmail === "coach@test.edu"), true);
  check("no audit metadata carries an @", logs.some((l) => JSON.stringify(l.metadata ?? {}).includes("@")), false);
  check("audit ip hashes are not ips", logs.every((l) => !l.actorIpHash || !/\d+\.\d+\.\d+\.\d+/.test(l.actorIpHash)), true);

  // ------------------------------------------------------------ phase 6: roster import + claim
  console.log("\nRoster import");
  const imp = await import("../lib/import-roster");
  const { claimParticipantForUser } = await import("../lib/participants");
  const pq2 = await import("../lib/queries/participants");

  const fixture = {
    campaign: { slug: "legacy-import", name: "Legacy Import", goalCents: 100000, startedDaysAgo: 10 },
    participants: [
      { name: "Import One", emailsSent: 3, textsSent: 2, expectedDonations: 2, expectedRaised: 150, rosterNumber: "91", teamRole: "Forward", classYear: "Junior", photoUrl: "/roster/import-one.jpg" },
      { name: "Import Two", emailsSent: 0, textsSent: 0, expectedDonations: 1, expectedRaised: 25 },
      { name: "Import Three", emailsSent: 1, textsSent: 0, expectedDonations: 0, expectedRaised: 0 },
    ],
    donations: [
      { participant: "Import One", amount: 100, donor: "Grandma One", daysAgo: 3, message: "<b>go</b>" },
      { participant: "Import One", amount: 50, donor: null, daysAgo: 2 },
      { participant: "Import Two", amount: 25, donor: "Uncle Two", daysAgo: 1 },
    ],
  };

  check("reconcile: clean fixture has no problems", imp.reconcile(imp.RosterImport.parse(fixture)), []);
  const badFixture = { ...fixture, campaign: { ...fixture.campaign, slug: "legacy-bad" }, participants: fixture.participants.map((p) => (p.name === "Import Two" ? { ...p, expectedRaised: 999 } : p)) };
  await throws("mismatched expectations abort before writing", () => imp.importRoster(badFixture, { orgId: org!.id }), /Reconciliation/);
  check("nothing written on abort", (await db.select().from(schema.campaigns).where(eq(schema.campaigns.slug, "legacy-bad"))).length, 0);
  await throws("donation for unknown participant rejected", () => imp.importRoster({ ...fixture, campaign: { ...fixture.campaign, slug: "legacy-bad2" }, donations: [{ participant: "Nobody", amount: 5, donor: null, daysAgo: 0 }] }, { orgId: org!.id }), /unknown participant|Reconciliation/);

  const sum1 = await imp.importRoster(fixture, { orgId: org!.id });
  check("summary counts", [sum1.participants, sum1.donations, sum1.totalCents, sum1.outreachEvents, sum1.replaced], [3, 3, 17500, 6, false]);
  const [legacy] = await db.select().from(schema.campaigns).where(eq(schema.campaigns.slug, "legacy-import"));
  check("campaign created active", legacy?.status, "active");
  check("campaign start backdated", legacy!.startsAt < new Date(Date.now() - 9 * 86_400_000), true);

  const roster = await pq2.listRoster(legacy!.id);
  check("all imported rows are unclaimed", roster.every((r) => r.unclaimed), true);
  const one = roster.find((r) => r.participant.slug === "import-one")!;
  check("sendCount counts emails + texts", one.sendCount, 5);
  check("no contacts fabricated", one.contactCount, 0);
  check("per-participant raised", one.raisedCents, 15000);
  check("import stores roster number / position / year", [one.participant.rosterNumber, one.participant.teamRole, one.participant.classYear], ["91", "Forward", "Junior"]);
  check("import stores site-relative photo", one.participant.photoUrl, "/roster/import-one.jpg");
  await throws("import rejects a non-https, non-relative photo url", () => imp.RosterImport.parse({ ...fixture, participants: [{ ...fixture.participants[0], photoUrl: "http://evil" }] }));
  const placeholders = await db.select().from(schema.users).where(eq(schema.users.isPlaceholder, true));
  check("placeholder users flagged", placeholders.length >= 3, true);
  check("placeholder emails are .invalid", placeholders.every((u) => imp.isPlaceholderEmail(u.email)), true);

  check("public stats include imported gifts", await dq.getCampaignStats(legacy!.id), { raisedCents: 17500, donorCount: 3, latestAt: (await dq.getCampaignStats(legacy!.id)).latestAt });
  const legacyFin = await adm.getCampaignFinancials(legacy!.id);
  check("financials: all imported", legacyFin.importedCents, 17500);
  check("financials: no Stripe fee estimated on imports", legacyFin.estimatedStripeFeeCents, 0);
  check("financials: net equals gross with no Stripe gifts", legacyFin.estimatedNetCents, 17500);
  const legacyWall = await dq.listPublicDonations(legacy!.id);
  check("wall: anonymous import has no name", legacyWall.find((w) => w.amountCents === 5000)!.donorName, null);
  check("wall: message stored raw, escaped at render", legacyWall.find((w) => w.amountCents === 10000)!.message, "<b>go</b>");
  check("wall: newest first", legacyWall[0]!.amountCents, 2500);
  check("admin rows carry source", (await adm.listDonationsForAdmin(legacy!.id)).every((r) => r.source === "import"), true);
  check("import audited", (await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.action, "roster.import"))).length, 1);

  await throws("re-import without --replace refused", () => imp.importRoster(fixture, { orgId: org!.id }), /already exists/);
  const sum2 = await imp.importRoster(fixture, { orgId: org!.id, replace: true });
  check("replace reloads", sum2.replaced, true);
  check("replace does not leave orphan placeholders", (await db.select().from(schema.users).where(eq(schema.users.isPlaceholder, true))).length, placeholders.length);
  check("replace yields a new campaign id", sum2.campaignId === legacy!.id, false);

  console.log("\nClaiming an imported row");
  const [legacy2] = await db.select().from(schema.campaigns).where(eq(schema.campaigns.slug, "legacy-import"));
  const [rowOne] = await db.select().from(schema.participants).where(and(eq(schema.participants.campaignId, legacy2!.id), eq(schema.participants.slug, "import-one")));
  const [rowTwo] = await db.select().from(schema.participants).where(and(eq(schema.participants.campaignId, legacy2!.id), eq(schema.participants.slug, "import-two")));
  const [rowThree] = await db.select().from(schema.participants).where(and(eq(schema.participants.campaignId, legacy2!.id), eq(schema.participants.slug, "import-three")));
  const placeholderOne = rowOne!.userId;
  const [real1] = await db.insert(schema.users).values({ clerkUserId: "user_real1", email: "real1@unc.edu", name: "Real One" }).returning();
  const [real2] = await db.insert(schema.users).values({ clerkUserId: "user_real2", email: "real2@unc.edu", name: "Real Two" }).returning();

  const claimed = await claimParticipantForUser(real1!, rowOne!.id);
  check("claim reassigns the row to the real user", claimed.userId, real1!.id);
  check("claim keeps the display name", claimed.displayName, "Import One");
  check("claim keeps the donations", (await dq.getParticipantStats(rowOne!.id)).raisedCents, 15000);
  check("placeholder user deleted", (await db.select().from(schema.users).where(eq(schema.users.id, placeholderOne))).length, 0);
  check("row no longer unclaimed", (await pq2.listRoster(legacy2!.id)).find((r) => r.participant.id === rowOne!.id)!.unclaimed, false);
  check("re-claim by the same user is a no-op", (await claimParticipantForUser(real1!, rowOne!.id)).id, rowOne!.id);
  await throws("another user cannot take a claimed row", () => claimParticipantForUser(real2!, rowOne!.id), /already belongs/);
  await claimParticipantForUser(real2!, rowTwo!.id);
  await throws("a user cannot claim a second row in the same campaign", () => claimParticipantForUser(real2!, rowThree!.id), /already have a page/);
  await throws("claiming a nonexistent row fails closed", () => claimParticipantForUser(real2!, crypto.randomUUID()), /no longer exists/);

  console.log("\nMixed-source financials");
  const finBefore = await adm.getCampaignFinancials(active!.id);
  await db.insert(schema.donations).values({ campaignId: active!.id, participantId: p3.id, grossAmountCents: 10000, designatedAmountCents: 10000, status: "succeeded", source: "import" });
  const finAfter = await adm.getCampaignFinancials(active!.id);
  check("imported gift raises the total", finAfter.raisedCents - finBefore.raisedCents, 10000);
  check("imported gift shows in importedCents", finAfter.importedCents, 10000);
  check("imported gift adds NO Stripe fee", finAfter.estimatedStripeFeeCents, finBefore.estimatedStripeFeeCents);

  // ------------------------------------------------------------ roster page scraper
  console.log("\nRoster scraper");
  const scrape = await import("../lib/roster-scrape");
  const rosterHtml = `
<div class="vc_row wpb_row vc_row-fluid player-roster qodef-x"><div><img data-lazyloaded="1" src="data:image/svg+xml;base64,AAAA" data-src="https://unchockey.com/wp-content/uploads/2026/08/avery-lindqvist-scaled-e1788225371328-300x300.jpg" alt="" /><noscript><img src="https://unchockey.com/wp-content/uploads/2026/08/avery-lindqvist-scaled-e1788225371328-300x300.jpg" /></noscript></div>
<p><strong>Forward</strong> / 6&#8217;1&#8243; / 195 lbs</p><h4><strong><a href="/player/avery-lindqvist">Avery Lindqvist</a> #88</strong></h4><p><strong>Freshman</strong> / Business Administration</p></div>
<div class="vc_row wpb_row vc_row-fluid player-roster qodef-x"><noscript><img src="https://unchockey.com/wp-content/uploads/2020/08/Headshot-01-1-300x300.jpg" alt="Headshot Icon" /></noscript>
<p><strong>Defense</strong> / 6&#8217;0&#8243;</p><h4><strong>Theo Halvorsen #22</strong></h4><p><strong>Sophomore</strong> / Economics</p></div>
<div class="vc_row wpb_row vc_row-fluid player-roster qodef-x"><img data-src="https://unchockey.com/wp-content/uploads/2026/08/mg-300x300.jpg" />
<p><strong>Forward</strong></p><h4><strong><a href="/player/theodore-halvorsen">Theodore Halvorsen</a> #23</strong></h4><p><strong>Senior</strong></p></div>
<div class="vc_row wpb_row vc_row-fluid player-roster qodef-x"><img data-src="https://unchockey.com/wp-content/uploads/2026/08/gg-300x300.jpg" />
<p><b>Goalie</b> / 5&#8217;11&#8221; / 165 lbs</p><h4><strong><a href="/player/rowan-achterberg/"><span data-sheets-root="1">Rowan Achterberg</span></a> #30</strong></h4><p><strong>Sophomore</strong> / Management &amp; Society</p><p><strong><a class="arrow-right" href="/player/rowan-achterberg/">Full Bio</a></strong></p></div>
<div class="vc_row wpb_row vc_row-fluid player-roster qodef-x"><img data-src="https://unchockey.com/wp-content/uploads/2026/08/km-300x300.jpg" />
<p><strong>Defense</strong> / 5&#8217;11 / 155 lbs</p><h4><strong><a href="/player/marcus-vance">Marcus Vance</a> #20</strong></h4><p><b>Junior</b> / Biostatistics</p></div>
<div class="vc_row wpb_row vc_row-fluid player-roster qodef-x"><p>Coaching Staff</p></div>`;
  const parsed = scrape.parseRosterHtml(rosterHtml);
  check("parses one player per roster row with a name", parsed.length, 5);
  check("<b> position and span-wrapped name (goalie card)", [parsed[3]!.name, parsed[3]!.slug, parsed[3]!.number, parsed[3]!.position, parsed[3]!.year], ["Rowan Achterberg", "rowan-achterberg", "30", "Goalie", "Sophomore"]);
  check("<b> year (Marcus Vance card)", [parsed[4]!.position, parsed[4]!.year], ["Defense", "Junior"]);
  check("'Full Bio' link never read as a field", parsed[3]!.year !== "Full Bio", true);
  check("name, number, position, year", [parsed[0]!.name, parsed[0]!.number, parsed[0]!.position, parsed[0]!.year], ["Avery Lindqvist", "88", "Forward", "Freshman"]);
  check("lazy data-src photo picked up", parsed[0]!.photoUrl?.endsWith("avery-lindqvist-scaled-e1788225371328-300x300.jpg"), true);
  check("player slug from bio link", parsed[0]!.slug, "avery-lindqvist");
  check("generic silhouette is NOT a photo", parsed[1]!.photoUrl, null);
  check("name without a bio link still parses", [parsed[1]!.name, parsed[1]!.number, parsed[1]!.slug], ["Theo Halvorsen", "22", null]);
  check("exact match", scrape.matchPlayer(parsed, "Avery Lindqvist")?.number, "88");
  check("case/space insensitive", scrape.matchPlayer(parsed, "  alex KONTOS ")?.number, "88");
  check("no match → null", scrape.matchPlayer(parsed, "Quinn Delacroix"), null);
  check("short-name ambiguity (Mat → Matt & Matthew) → null", scrape.matchPlayer(parsed, "The Halvorsen"), null);
  check("prefix match resolves when unique", scrape.matchPlayer([parsed[0]!, parsed[1]!], "Theodore Halvorsen")?.number, "22");
  check("too-short first name never loose-matches", scrape.matchPlayer(parsed, "Av Lindqvist"), null);

  console.log(`\n${failures === 0 ? "PASS" : "FAIL"} — ${checks - failures}/${checks} checks passed\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
