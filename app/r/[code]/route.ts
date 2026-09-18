import { NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { shareLinks, linkEvents, participants } from "@/lib/db/schema";
import { siteUrl } from "@/lib/stripe";

/**
 * The short link every player shares. Records the click, then forwards to that
 * player's page carrying ?ref= so a gift can be traced back to the exact
 * contact who was messaged.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code } = await params;

  const [row] = await db
    .select({
      id: shareLinks.id,
      slug: participants.slug,
    })
    .from(shareLinks)
    .innerJoin(participants, eq(shareLinks.participantId, participants.id))
    .where(eq(shareLinks.code, code))
    .limit(1);

  if (!row) return NextResponse.redirect(siteUrl("/"));

  // Best-effort: a tracking failure must never cost the team a donation.
  try {
    await db
      .update(shareLinks)
      .set({ clickCount: sql`${shareLinks.clickCount} + 1` })
      .where(eq(shareLinks.id, row.id));

    await db.insert(linkEvents).values({
      shareLinkId: row.id,
      referer: req.headers.get("referer")?.slice(0, 500) ?? null,
      userAgent: req.headers.get("user-agent")?.slice(0, 500) ?? null,
    });
  } catch (err) {
    console.error("Click tracking failed", err);
  }

  return NextResponse.redirect(
    siteUrl(`/p/${row.slug}?ref=${encodeURIComponent(code)}`),
  );
}
