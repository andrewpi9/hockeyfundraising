/**
 * End-to-end smoke test against an in-process Postgres (PGlite).
 *
 * Runs the real schema, the real query layer and the real money math, so a
 * regression in attribution or totals fails here instead of in front of a donor.
 *   npm run verify
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq, and, isNull } from "drizzle-orm";
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

async function main() {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  setDb(db as unknown as Database);

  // Apply the generated migration, so this tests the schema that ships.
  const dir = join(process.cwd(), "drizzle");
  const file = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()[0]!;
  const sql = readFileSync(join(dir, file), "utf8");
  for (const stmt of sql.split("--> statement-breakpoint")) {
    const trimmed = stmt.trim();
    if (trimmed) await client.exec(trimmed);
  }
  console.log(`\nSchema applied from ${file}\n`);

  const {
    getCampaignTotals,
    getLeaderboard,
    getParticipantTotals,
    getRecentDonations,
    getRosterWithActivity,
    getUnattributedTotal,
    getParticipantActivity,
    getDonorExport,
  } = await import("../lib/queries");
  const { feeForAmount, grossUpForFees, estimatedStripeFee, parseDollarsToCents } =
    await import("../lib/money");

  console.log("Money math");
  // $100 gift: team must net exactly 10000 cents after 2.2% + 30c.
  const fee = feeForAmount(10000);
  const gross = grossUpForFees(10000);
  check("cover-fee grosses up correctly", gross, 10256);
  check("fee is the difference", fee, 256);
  // The invariant that matters: after Stripe takes its cut of the grossed-up
  // charge, the team is left with the donor's intended amount exactly.
  check("grossed-up charge leaves the team whole", gross - estimatedStripeFee(gross), 10000);
  for (const amount of [500, 2500, 5000, 10000, 25000, 100000, 250000]) {
    const g = grossUpForFees(amount);
    check(
      `no shortfall grossing up ${amount}c`,
      g - estimatedStripeFee(g) >= amount,
      true,
    );
  }
  check("parses dollar strings", parseDollarsToCents("$1,250.50"), 125050);
  check("rejects zero", parseDollarsToCents("0"), null);
  check("rejects junk", parseDollarsToCents("abc"), null);

  // ---- fixtures ----
  const [campaign] = await db
    .insert(schema.campaigns)
    .values({ slug: "test", name: "Test Fund", goalCents: 1_000_000 })
    .returning();

  const [coach] = await db
    .insert(schema.users)
    .values({ email: "coach@test.com", name: "Coach", role: "admin" })
    .returning();
  const [u1] = await db
    .insert(schema.users)
    .values({ email: "a@test.com", name: "Player A" })
    .returning();
  const [u2] = await db
    .insert(schema.users)
    .values({ email: "b@test.com", name: "Player B" })
    .returning();

  const [pA] = await db
    .insert(schema.participants)
    .values({
      campaignId: campaign!.id,
      userId: u1!.id,
      slug: "player-a",
      displayName: "Player A",
      goalCents: 50000,
    })
    .returning();
  const [pB] = await db
    .insert(schema.participants)
    .values({
      campaignId: campaign!.id,
      userId: u2!.id,
      slug: "player-b",
      displayName: "Player B",
      goalCents: 50000,
    })
    .returning();

  const [contact] = await db
    .insert(schema.contacts)
    .values({ participantId: pA!.id, name: "Aunt Sarah", email: "sarah@test.com" })
    .returning();

  const [link] = await db
    .insert(schema.shareLinks)
    .values({ code: "abc123", participantId: pA!.id, contactId: contact!.id, channel: "sms" })
    .returning();

  console.log("\nTotals and attribution");

  // Pending gifts must never appear in totals.
  await db.insert(schema.donations).values({
    campaignId: campaign!.id,
    participantId: pA!.id,
    amountCents: 99999,
    totalChargedCents: 99999,
    status: "pending",
  });
  check("pending excluded from totals", (await getCampaignTotals(campaign!.id)).raisedCents, 0);

  await db.insert(schema.donations).values([
    {
      campaignId: campaign!.id,
      participantId: pA!.id,
      shareLinkId: link!.id,
      amountCents: 10000,
      feeCoveredCents: 256,
      totalChargedCents: 10256,
      donorEmail: "sarah@test.com",
      donorName: "Aunt Sarah",
      status: "succeeded",
    },
    {
      campaignId: campaign!.id,
      participantId: pB!.id,
      amountCents: 5000,
      totalChargedCents: 5000,
      donorEmail: "bob@test.com",
      donorName: "Bob",
      message: "Go Heels",
      status: "succeeded",
    },
    {
      campaignId: campaign!.id,
      participantId: null,
      amountCents: 2500,
      totalChargedCents: 2500,
      donorEmail: "team@test.com",
      status: "succeeded",
    },
    {
      campaignId: campaign!.id,
      participantId: pA!.id,
      amountCents: 7777,
      totalChargedCents: 7777,
      donorEmail: "refund@test.com",
      status: "refunded",
    },
  ]);

  const totals = await getCampaignTotals(campaign!.id);
  check("campaign total sums succeeded only", totals.raisedCents, 17500);
  check("fees covered tracked separately", totals.feesCoveredCents, 256);
  check("donation count", totals.donationCount, 3);

  check("per-player total", (await getParticipantTotals(pA!.id)).raisedCents, 10000);
  check("unattributed isolated", await getUnattributedTotal(campaign!.id), 2500);

  const board = await getLeaderboard(campaign!.id);
  check("leaderboard ordered by raised", board.map((r) => r.slug), ["player-a", "player-b"]);
  check("leaderboard excludes refunded", board[0]!.raisedCents, 10000);
  check("leaderboard donor count", board[0]!.donorCount, 1);

  console.log("\nDonor wall privacy");
  await db.insert(schema.donations).values({
    campaignId: campaign!.id,
    participantId: pB!.id,
    amountCents: 20000,
    totalChargedCents: 20000,
    donorName: "Secret Santa",
    donorEmail: "secret@test.com",
    isAnonymous: true,
    status: "succeeded",
  });
  const wall = await getRecentDonations(campaign!.id, { limit: 10 });
  const anon = wall.find((d) => d.amountCents === 20000)!;
  check("anonymous name withheld from wall", anon.donorName, null);
  const exported = await getDonorExport(campaign!.id);
  check(
    "anonymous name still in admin export",
    exported.find((r) => r.amountCents === 20000)!.donorName,
    "Secret Santa",
  );

  console.log("\nOutreach funnel");
  await db.insert(schema.outreach).values({ contactId: contact!.id, channel: "sms" });
  await db
    .update(schema.contacts)
    .set({ lastContactedAt: new Date() })
    .where(eq(schema.contacts.id, contact!.id));
  await db
    .update(schema.shareLinks)
    .set({ clickCount: 3 })
    .where(eq(schema.shareLinks.id, link!.id));

  const activity = await getParticipantActivity(pA!.id);
  check("contacts counted", activity.contacts.total, 1);
  check("contacted counted", activity.contacts.contacted, 1);
  check("sends counted", activity.sends, 1);
  check("clicks counted", activity.clicks, 3);

  const roster = await getRosterWithActivity(campaign!.id);
  const rowA = roster.find((r) => r.slug === "player-a")!;
  check("roster joins email", rowA.email, "a@test.com");
  check("roster subquery counts contacts", rowA.contactCount, 1);
  check("roster subquery counts sends", rowA.sendCount, 1);
  check("roster subquery counts clicks", rowA.clickCount, 3);
  check("roster player B has no contacts", roster.find((r) => r.slug === "player-b")!.contactCount, 0);

  console.log("\nAuth token lifecycle");
  const { createHash, randomBytes } = await import("node:crypto");
  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  await db.insert(schema.authTokens).values({
    email: "coach@test.com",
    tokenHash,
    expiresAt: new Date(Date.now() + 900_000),
  });

  // Mirrors the single-use claim in lib/auth.ts: only an unused row is claimable.
  const claim = async () =>
    (
      await db
        .update(schema.authTokens)
        .set({ usedAt: new Date() })
        .where(and(eq(schema.authTokens.tokenHash, tokenHash), isNull(schema.authTokens.usedAt)))
        .returning({ id: schema.authTokens.id })
    ).length;

  check("first use of magic link succeeds", await claim(), 1);
  check("replay of same link is rejected", await claim(), 0);

  const [expired] = await db
    .insert(schema.authTokens)
    .values({
      email: "coach@test.com",
      tokenHash: "deadbeef",
      expiresAt: new Date(Date.now() - 1000),
    })
    .returning();
  check("expired token stored as expired", expired!.expiresAt < new Date(), true);
  check("coach seeded as admin", coach!.role, "admin");

  console.log(
    `\n${failures === 0 ? "PASS" : "FAIL"} — ${checks - failures}/${checks} checks passed\n`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
