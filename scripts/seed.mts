import { loadLocalEnv } from "../lib/loadenv";

loadLocalEnv();

// Imported after env is loaded — the db module throws without DATABASE_URL.
const { db } = await import("../lib/db");
const { campaigns, users, participants } = await import("../lib/db/schema");
const { eq } = await import("drizzle-orm");
const { slugify } = await import("../lib/ids");

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? process.argv[2];

if (!ADMIN_EMAIL) {
  console.error(
    "\nPass the coach's email so you can sign in:\n" +
      "  npm run db:seed -- you@unc.edu\n",
  );
  process.exit(1);
}

const STORY = `Carolina hockey is a club program. The university covers almost none of it, so the roster pays for the season out of pocket — and the number that breaks people is ice time.

A single hour of ice at our home rink runs about $340. We practice twice a week and play 24 games, half of them on the road. Add referees, league dues, and a bus to Blacksburg and back, and a season costs roughly $1,600 per player before anyone buys a stick.

This fundraiser closes that gap. Every dollar you give goes to ice, travel, and gear — there is no platform taking a cut of it.`;

const ROSTER = [
  { name: "Chris Miller", goal: 60000 },
  { name: "Andrew Pi", goal: 60000 },
  { name: "Sam Rodriguez", goal: 50000 },
  { name: "Tyler Novak", goal: 50000 },
];

async function main() {
  const email = ADMIN_EMAIL!.trim().toLowerCase();

  let [campaign] = await db
    .select()
    .from(campaigns)
    .where(eq(campaigns.slug, "2026-season"))
    .limit(1);

  if (!campaign) {
    [campaign] = await db
      .insert(campaigns)
      .values({
        slug: "2026-season",
        name: "UNC Hockey 2026 Season Fund",
        tagline: "Carolina Club Hockey",
        story: STORY,
        goalCents: 2_500_000,
        endsAt: new Date(Date.now() + 45 * 86_400_000),
        isActive: true,
      })
      .returning();
    console.log("Created campaign: UNC Hockey 2026 Season Fund");
  } else {
    console.log("Campaign already exists, reusing it.");
  }

  let [admin] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!admin) {
    [admin] = await db
      .insert(users)
      .values({ email, name: "Coach", role: "admin" })
      .returning();
    console.log(`Created admin: ${email}`);
  } else if (admin.role !== "admin") {
    await db.update(users).set({ role: "admin" }).where(eq(users.id, admin.id));
    console.log(`Promoted ${email} to admin`);
  }

  for (const player of ROSTER) {
    const playerEmail = `${slugify(player.name)}@example.com`;
    let [user] = await db
      .select()
      .from(users)
      .where(eq(users.email, playerEmail))
      .limit(1);

    if (!user) {
      [user] = await db
        .insert(users)
        .values({ email: playerEmail, name: player.name, role: "player" })
        .returning();
    }

    const existing = await db
      .select({ id: participants.id })
      .from(participants)
      .where(eq(participants.userId, user!.id))
      .limit(1);

    if (existing.length === 0) {
      await db.insert(participants).values({
        campaignId: campaign!.id,
        userId: user!.id,
        slug: slugify(player.name),
        displayName: player.name,
        goalCents: player.goal,
      });
      console.log(`  + ${player.name}`);
    }
  }

  console.log(`\nDone. Sign in at /login as ${email}\n`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
