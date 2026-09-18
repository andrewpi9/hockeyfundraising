import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "./db";
import { shareLinks, linkEvents } from "./db/schema";
import { shareCode } from "./ids";
import { hashIp } from "./crypto";
import { uaFamily, refererHost } from "./ua";

/** Every participant has exactly one personal link; minted on first request. */
export async function ensurePersonalShareLink(participantId: string, campaignId: string): Promise<string> {
  const [existing] = await db
    .select({ code: shareLinks.code })
    .from(shareLinks)
    .where(and(eq(shareLinks.participantId, participantId), eq(shareLinks.medium, "personal"), isNull(shareLinks.contactId)))
    .limit(1);
  if (existing) return existing.code;

  const [created] = await db
    .insert(shareLinks)
    .values({ code: shareCode(), participantId, campaignId, medium: "personal" })
    .returning({ code: shareLinks.code });
  return created!.code;
}

/** Best effort — analytics must never cost a donation. Stores hashes and families, never raw values. */
export async function recordClick(shareLinkId: string, req: { ip: string; userAgent: string | null; referer: string | null }) {
  try {
    await db.update(shareLinks).set({ clickCount: sql`${shareLinks.clickCount} + 1` }).where(eq(shareLinks.id, shareLinkId));
    await db.insert(linkEvents).values({
      shareLinkId,
      ipHash: hashIp(req.ip),
      uaFamily: uaFamily(req.userAgent),
      refererHost: refererHost(req.referer),
    });
  } catch (err) {
    console.error("[click] tracking failed:", err instanceof Error ? err.message : "unknown");
  }
}
