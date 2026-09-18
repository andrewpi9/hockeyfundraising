import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { donations, participants, campaigns } from "@/lib/db/schema";
import { decryptOptional, CTX } from "@/lib/crypto";

const SUCCEEDED = eq(donations.status, "succeeded");

/** What the public wall shows. Never a name for an anonymous gift; never an email. */
export type WallEntry = {
  id: string;
  amountCents: number;
  donorName: string | null;
  message: string | null;
  agoLabel: string;
  participantName: string | null;
  participantSlug: string | null;
};

const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
export function agoLabel(date: Date, now: Date = new Date()): string {
  const seconds = Math.round((date.getTime() - now.getTime()) / 1000);
  for (const [unit, size] of [["day", 86400], ["hour", 3600], ["minute", 60]] as const) {
    if (Math.abs(seconds) >= size) return rtf.format(Math.round(seconds / size), unit);
  }
  return "just now";
}

export async function listPublicDonations(
  campaignId: string,
  opts: { participantId?: string; limit?: number; now?: Date } = {},
): Promise<WallEntry[]> {
  const where = [eq(donations.campaignId, campaignId), SUCCEEDED];
  if (opts.participantId) where.push(eq(donations.participantId, opts.participantId));

  const rows = await db
    .select({
      id: donations.id,
      amountCents: donations.designatedAmountCents,
      nameCiphertext: donations.donorNameCiphertext,
      messageCiphertext: donations.messageCiphertext,
      isAnonymous: donations.isAnonymous,
      createdAt: donations.createdAt,
      participantName: participants.displayName,
      participantSlug: participants.slug,
    })
    .from(donations)
    .leftJoin(participants, eq(donations.participantId, participants.id))
    .where(and(...where))
    .orderBy(desc(donations.createdAt))
    .limit(opts.limit ?? 25);

  return rows.map((r) => ({
    id: r.id,
    amountCents: r.amountCents,
    donorName: r.isAnonymous ? null : decryptOptional(r.nameCiphertext, CTX.donorName),
    message: decryptOptional(r.messageCiphertext, CTX.donorMessage),
    agoLabel: agoLabel(r.createdAt, opts.now),
    participantName: r.participantName,
    participantSlug: r.participantSlug,
  }));
}

/** Confirmation page lookup. Decrypts only the first name, for the greeting. */
export async function getDonationBySession(sessionId: string) {
  const [row] = await db
    .select({
      id: donations.id,
      status: donations.status,
      amountCents: donations.designatedAmountCents,
      feeCoveredCents: donations.feeCoveredCents,
      nameCiphertext: donations.donorNameCiphertext,
      paymentMethodType: donations.paymentMethodType,
      campaignSlug: campaigns.slug,
      campaignName: campaigns.name,
      participantName: participants.displayName,
      participantSlug: participants.slug,
    })
    .from(donations)
    .innerJoin(campaigns, eq(donations.campaignId, campaigns.id))
    .leftJoin(participants, eq(donations.participantId, participants.id))
    .where(eq(donations.stripeCheckoutSessionId, sessionId))
    .limit(1);
  if (!row) return null;
  const { nameCiphertext, ...rest } = row;
  const full = decryptOptional(nameCiphertext, CTX.donorName);
  return { ...rest, firstName: full?.split(" ")[0] ?? null };
}

/** PII-free numbers for the live thermometer. Safe to cache and to poll. */
export async function getCampaignStats(campaignId: string) {
  const [row] = await db
    .select({
      raisedCents: sql<number>`coalesce(sum(${donations.designatedAmountCents}), 0)::int`,
      donorCount: sql<number>`count(*)::int`,
      latestAt: sql<Date | null>`max(${donations.createdAt})`,
    })
    .from(donations)
    .where(and(eq(donations.campaignId, campaignId), SUCCEEDED));
  return { raisedCents: row?.raisedCents ?? 0, donorCount: row?.donorCount ?? 0, latestAt: row?.latestAt ?? null };
}
