/**
 * Parses the team's public roster page (WordPress + WPBakery "player-roster"
 * rows) into structured players, and matches them to participants by name.
 * Pure: takes HTML, returns data. The network and the database live in
 * scripts/roster-photos.mts.
 */
export type RosterPlayer = {
  name: string;
  slug: string | null;
  number: string | null;
  position: string | null;
  year: string | null;
  /** 300×300 thumbnail URL, or null when the site shows its generic silhouette. */
  photoUrl: string | null;
};

const entities = (s: string) =>
  s
    .replace(/&#8217;|&rsquo;|&#039;|&#x27;/g, "'")
    .replace(/&#8220;|&#8221;|&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();

export function parseRosterHtml(html: string): RosterPlayer[] {
  const chunks = html.split(/<div class="vc_row wpb_row vc_row-fluid player-roster/).slice(1);
  const players: RosterPlayer[] = [];

  for (const chunk of chunks) {
    const h4 = chunk.match(/<h4>\s*<strong>([\s\S]*?)<\/strong>\s*<\/h4>/);
    if (!h4) continue;
    const inner = h4[1]!;
    // Some names are wrapped in a <span data-sheets-root> inside the link; entities() strips tags.
    const link = inner.match(/<a href="\/player\/([^"/]+)\/?">([\s\S]*?)<\/a>/);
    const number = inner.match(/#\s*(\d{1,2})/)?.[1] ?? null;
    const name = entities(link ? link[2]! : inner.replace(/#\s*\d{1,2}/, ""));
    if (!name) continue;

    // Position and year lead their paragraphs in <strong> on most cards and <b> on a few.
    const strongs = [...chunk.matchAll(/<p[^>]*>\s*<(strong|b)>([^<]+)<\/\1>/g)].map((m) => entities(m[2]!));
    const src =
      chunk.match(/data-src="(https:[^"]+-300x300\.(?:jpe?g|png))"/)?.[1] ??
      chunk.match(/<noscript><img[^>]+src="(https:[^"]+-300x300\.(?:jpe?g|png))"/)?.[1] ??
      null;

    players.push({
      name,
      slug: link?.[1] ?? null,
      number,
      position: strongs[0] ?? null,
      year: strongs[1] ?? null,
      photoUrl: src && !/Headshot-01/i.test(src) ? src : null,
    });
  }
  return players;
}

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z ]/g, "").replace(/\s+/g, " ").trim();

/**
 * Exact name first; otherwise same surname and one first name is a prefix of
 * the other (Matt/Matthew, Nic/Nicolas, Cam/Camden). Returns null on ambiguity.
 */
export function matchPlayer(players: RosterPlayer[], participantName: string): RosterPlayer | null {
  const target = norm(participantName);
  const exact = players.filter((p) => norm(p.name) === target);
  if (exact.length === 1) return exact[0]!;
  if (exact.length > 1) return null;

  const [tFirst = "", ...tRest] = target.split(" ");
  const tLast = tRest.at(-1) ?? "";
  if (!tLast || tFirst.length < 3) return null;

  const loose = players.filter((p) => {
    const [pFirst = "", ...pRest] = norm(p.name).split(" ");
    const pLast = pRest.at(-1) ?? "";
    return pLast === tLast && (pFirst.startsWith(tFirst) || tFirst.startsWith(pFirst)) && Math.min(pFirst.length, tFirst.length) >= 3;
  });
  return loose.length === 1 ? loose[0]! : null;
}
