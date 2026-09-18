/**
 * Load a previous campaign's roster and donations.
 *
 *   npm run db:import -- data/import-hockey-2026.json
 *   npm run db:import -- data/import-hockey-2026.json --replace   # wipe and reload
 *
 * Donor names are PII: keep the data file under data/ (gitignored).
 * Stop `npm run dev` first if you are on the bundled dev database.
 */
import { readFileSync } from "node:fs";
import { loadLocalEnv } from "../lib/loadenv";
loadLocalEnv();

const file = process.argv.find((a) => a.endsWith(".json"));
const replace = process.argv.includes("--replace");
if (!file) {
  console.error("Usage: npm run db:import -- <file.json> [--replace]");
  process.exit(1);
}

const { db } = await import("../lib/db");
const { organizations } = await import("../lib/db/schema");
const { importRoster, ReconciliationError } = await import("../lib/import-roster");

const [org] = await db.select().from(organizations).limit(1);
if (!org) {
  console.error("No organization. Run: npm run db:seed");
  process.exit(1);
}

try {
  const summary = await importRoster(JSON.parse(readFileSync(file, "utf8")), { orgId: org.id, replace, platformFeeBps: org.platformFeeBps });
  console.log(`
Imported into "${summary.campaignSlug}"${summary.replaced ? " (replaced previous load)" : ""}
  participants    ${summary.participants}
  donations       ${summary.donations}   $${(summary.totalCents / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}
  outreach events ${summary.outreachEvents}
${summary.claimedRowsDropped ? `  ! ${summary.claimedRowsDropped} claimed participant row(s) were dropped by --replace; those people must re-claim.\n` : ""}
Every participant is "unclaimed" until you send them a claim invite from the admin roster.
Public page: /c/${summary.campaignSlug}
`);
  process.exit(0);
} catch (err) {
  console.error(err instanceof ReconciliationError ? err.message : err instanceof Error ? err.message : err);
  process.exit(1);
}
