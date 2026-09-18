import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { shareLinks, participants, campaigns } from "@/lib/db/schema";
import { limiters, clientIp } from "@/lib/ratelimit";
import { recordClick } from "@/lib/sharing";
import { siteUrl } from "@/lib/site";

/**
 * The short link participants share. Records the click (hashed IP, browser
 * family, referring host — nothing identifying) and forwards with ?ref= so a
 * gift can be attributed to the exact link, and through it the exact contact.
 */
export async function GET(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const ip = clientIp(req);
  if (!(await limiters.redirect.limit(ip)).success) return NextResponse.redirect(siteUrl("/"), 302);

  const { code } = await params;
  const [row] = await db
    .select({ linkId: shareLinks.id, participantSlug: participants.slug, campaignSlug: campaigns.slug, campaignStatus: campaigns.status })
    .from(shareLinks)
    .innerJoin(participants, and(eq(shareLinks.participantId, participants.id), eq(participants.status, "active")))
    .innerJoin(campaigns, eq(shareLinks.campaignId, campaigns.id))
    .where(eq(shareLinks.code, code))
    .limit(1);

  if (!row || row.campaignStatus === "draft") return NextResponse.redirect(siteUrl("/"), 302);

  await recordClick(row.linkId, {
    ip,
    userAgent: req.headers.get("user-agent"),
    referer: req.headers.get("referer"),
  });

  return NextResponse.redirect(siteUrl(`/c/${row.campaignSlug}/${row.participantSlug}?ref=${encodeURIComponent(code)}`), 302);
}
