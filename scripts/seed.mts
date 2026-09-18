/**
 * Creates the organization row. That is all a fresh install needs:
 *   - Admins come from BOOTSTRAP_ADMIN_EMAILS on their first Clerk sign-in.
 *   - Campaigns and participants are created through the admin UI.
 *
 *   npm run db:seed
 */
import { loadLocalEnv } from "../lib/loadenv";
loadLocalEnv();

const { db } = await import("../lib/db");
const { organizations } = await import("../lib/db/schema");

const [existing] = await db.select().from(organizations).limit(1);
if (existing) {
  console.log(`Organization already exists: ${existing.name} (${existing.slug}). Nothing to do.`);
} else {
  const [org] = await db
    .insert(organizations)
    .values({
      slug: "unc-boosters",
      name: "UNC Club Sports Boosters",
      legalName: process.env.SEED_ORG_LEGAL_NAME ?? null,
      ein: process.env.SEED_ORG_EIN ?? null,
      platformFeeBps: 0,
    })
    .returning();
  console.log(`Created organization: ${org!.name}`);
}

console.log(
  `\nNext: sign in at /sign-in with an address listed in BOOTSTRAP_ADMIN_EMAILS.\n` +
    `That account becomes org owner on first sign-in, then create a campaign at /admin.\n`,
);
process.exit(0);
