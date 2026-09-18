/**
 * Pull headshots, jersey numbers, positions and years from the team's public
 * roster page onto a campaign's participants.
 *
 *   npm run roster:sync -- --campaign 2026-2027-season-fund [--json data/file.json]
 *
 * Photos are saved under public/roster/<participant-slug>.<ext> and served
 * from this site (CSP img-src 'self'), so nothing hotlinks the team site.
 * A photo a participant uploaded themselves (a Vercel Blob URL) is never
 * overwritten. With --json, the import file is patched so a later
 * `db:import --replace` keeps everything.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { loadLocalEnv } from "../lib/loadenv";
loadLocalEnv();

const ROSTER_URL = process.env.ROSTER_URL ?? "https://unchockey.com/roster/";
const arg = (flag: string) => { const i = process.argv.indexOf(flag); return i >= 0 ? process.argv[i + 1] : undefined; };
const campaignSlug = arg("--campaign");
const jsonPath = arg("--json");
if (!campaignSlug) { console.error("Usage: npm run roster:sync -- --campaign <slug> [--json data/file.json]"); process.exit(1); }

const { db } = await import("../lib/db");
const { campaigns, participants } = await import("../lib/db/schema");
const { eq, and } = await import("drizzle-orm");
const { parseRosterHtml, matchPlayer } = await import("../lib/roster-scrape");
const { isOurBlobUrl, sniffImageType, extensionFor } = await import("../lib/images");
const { audit } = await import("../lib/audit");

const [campaign] = await db.select().from(campaigns).where(eq(campaigns.slug, campaignSlug)).limit(1);
if (!campaign) { console.error(`No campaign with slug "${campaignSlug}"`); process.exit(1); }

const res = await fetch(ROSTER_URL, { headers: { "user-agent": "Mozilla/5.0 (roster sync)" } });
if (!res.ok) { console.error(`Roster page returned ${res.status}`); process.exit(1); }
const players = parseRosterHtml(await res.text());
console.log(`roster page: ${players.length} players parsed`);

const roster = await db.select().from(participants).where(and(eq(participants.campaignId, campaign.id), eq(participants.status, "active")));
mkdirSync(join(process.cwd(), "public", "roster"), { recursive: true });

const patch = new Map<string, { photoUrl?: string; rosterNumber?: string; teamRole?: string; classYear?: string }>();
let matched = 0, photos = 0, kept = 0;
const unmatched: string[] = [];

for (const p of roster) {
  const player = matchPlayer(players, p.displayName);
  if (!player) { unmatched.push(p.displayName); continue; }
  matched += 1;

  let photoUrl: string | null = null;
  if (isOurBlobUrl(p.photoUrl)) {
    kept += 1;
  } else if (player.photoUrl) {
    const img = await fetch(player.photoUrl, { headers: { "user-agent": "Mozilla/5.0 (roster sync)" } });
    if (img.ok) {
      const bytes = new Uint8Array(await img.arrayBuffer());
      const type = sniffImageType(bytes);
      if (type) {
        const file = `${p.slug}.${extensionFor[type]}`;
        writeFileSync(join(process.cwd(), "public", "roster", file), bytes);
        photoUrl = `/roster/${file}`;
        photos += 1;
      }
    }
  }

  await db
    .update(participants)
    .set({
      ...(photoUrl ? { photoUrl } : {}),
      rosterNumber: player.number ?? p.rosterNumber,
      teamRole: player.position ?? p.teamRole,
      classYear: player.year ?? p.classYear,
      updatedAt: new Date(),
    })
    .where(eq(participants.id, p.id));

  patch.set(p.displayName, {
    ...(photoUrl ? { photoUrl } : {}),
    ...(player.number ? { rosterNumber: player.number } : {}),
    ...(player.position ? { teamRole: player.position } : {}),
    ...(player.year ? { classYear: player.year } : {}),
  });
  console.log(`  ${p.displayName.padEnd(18)} ← ${player.name.padEnd(18)} #${(player.number ?? "").padEnd(3)} ${(player.position ?? "").padEnd(8)} ${(player.year ?? "").padEnd(10)} ${photoUrl ? "photo" : kept ? "kept own photo" : player.photoUrl ? "photo failed" : "no photo on roster"}`);
}

if (jsonPath) {
  const data = JSON.parse(readFileSync(jsonPath, "utf8"));
  for (const row of data.participants ?? []) Object.assign(row, patch.get(row.name) ?? {});
  writeFileSync(jsonPath, JSON.stringify(data, null, 2) + "\n");
  console.log(`patched ${jsonPath}`);
}

await audit({ action: "roster.sync", targetType: "campaign", targetId: campaign.id, orgId: campaign.orgId, metadata: { matched, photos, unmatched: unmatched.length, source_players: players.length } });
console.log(`\nmatched ${matched}/${roster.length}, ${photos} photos saved, ${kept} own uploads kept${unmatched.length ? `\nunmatched: ${unmatched.join(", ")}` : ""}`);
process.exit(0);
