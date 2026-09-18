/**
 * ADMIN-ONLY. Every function here decrypts donor PII. Callers must have passed
 * requireCampaignAdmin and must write an audit row (donation.view_pii or
 * donation.export) for the read. Nothing in this file is reachable from a
 * public or participant route.
 */
import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { donations, participants, shareLinks } from "@/lib/db/schema";
import { decryptOptional, CTX } from "@/lib/crypto";
import { estimatedStripeFee } from "@/lib/money";

export type AdminDonationRow = {
  id: string;
  createdAt: Date;
  status: string;
  donorName: string | null;
  donorEmail: string | null;
  message: string | null;
  isAnonymous: boolean;
  designatedCents: number;
  feeCoveredCents: number;
  platformFeeCents: number;
  grossCents: number;
  refundedCents: number;
  paymentMethodType: string | null;
  participantName: string | null;
  participantSlug: string | null;
  medium: string | null;
  source: "stripe" | "import";
  stripePaymentIntentId: string | null;
};

async function rows(campaignId: string, limit?: number): Promise<AdminDonationRow[]> {
  const q = db
    .select({
      d: donations,
      participantName: participants.displayName,
      participantSlug: participants.slug,
      medium: shareLinks.medium,
    })
    .from(donations)
    .leftJoin(participants, eq(donations.participantId, participants.id))
    .leftJoin(shareLinks, eq(donations.shareLinkId, shareLinks.id))
    .where(eq(donations.campaignId, campaignId))
    .orderBy(desc(donations.createdAt));
  const result = await (limit ? q.limit(limit) : q);

  return result.map(({ d, participantName, participantSlug, medium }) => ({
    id: d.id,
    createdAt: d.createdAt,
    status: d.status,
    donorName: decryptOptional(d.donorNameCiphertext, CTX.donorName),
    donorEmail: decryptOptional(d.donorEmailCiphertext, CTX.donorEmail),
    message: decryptOptional(d.messageCiphertext, CTX.donorMessage),
    isAnonymous: d.isAnonymous,
    designatedCents: d.designatedAmountCents,
    feeCoveredCents: d.feeCoveredCents,
    platformFeeCents: d.platformFeeCents,
    grossCents: d.grossAmountCents,
    refundedCents: d.refundedAmountCents,
    paymentMethodType: d.paymentMethodType,
    participantName,
    participantSlug,
    medium,
    source: d.source,
    stripePaymentIntentId: d.stripePaymentIntentId,
  }));
}

export const listDonationsForAdmin = (campaignId: string, limit = 50) => rows(campaignId, limit);
export const exportDonationsForAdmin = (campaignId: string) => rows(campaignId);

export type Financials = {
  raisedCents: number;
  grossCents: number;
  feeCoveredCents: number;
  platformFeeCents: number;
  refundedCents: number;
  /** Gifts recorded from outside Stripe (imports). Counted in raised, excluded from fee estimates. */
  importedCents: number;
  estimatedStripeFeeCents: number;
  estimatedNetCents: number;
  counts: Record<"succeeded" | "pending" | "refunded" | "partially_refunded" | "failed" | "disputed", number>;
  feeCoverRate: number;
};

/** Aggregates only — no PII — but admin-scoped because refund/dispute counts are internal. */
export async function getCampaignFinancials(campaignId: string): Promise<Financials> {
  const s = (status: string) => sql`${donations.status} = ${status}`;
  const [r] = await db
    .select({
      raised: sql<number>`coalesce(sum(${donations.designatedAmountCents}) filter (where ${s("succeeded")}), 0)::int`,
      gross: sql<number>`coalesce(sum(${donations.grossAmountCents}) filter (where ${s("succeeded")}), 0)::int`,
      feeCovered: sql<number>`coalesce(sum(${donations.feeCoveredCents}) filter (where ${s("succeeded")}), 0)::int`,
      platformFee: sql<number>`coalesce(sum(${donations.platformFeeCents}) filter (where ${s("succeeded")}), 0)::int`,
      refunded: sql<number>`coalesce(sum(${donations.refundedAmountCents}), 0)::int`,
      succeeded: sql<number>`count(*) filter (where ${s("succeeded")})::int`,
      pending: sql<number>`count(*) filter (where ${s("pending")})::int`,
      refundedN: sql<number>`count(*) filter (where ${s("refunded")})::int`,
      partial: sql<number>`count(*) filter (where ${s("partially_refunded")})::int`,
      failed: sql<number>`count(*) filter (where ${s("failed")})::int`,
      disputed: sql<number>`count(*) filter (where ${s("disputed")})::int`,
      covered: sql<number>`count(*) filter (where ${s("succeeded")} and ${donations.feeCoveredCents} > 0)::int`,
      imported: sql<number>`coalesce(sum(${donations.designatedAmountCents}) filter (where ${s("succeeded")} and ${donations.source} = 'import'), 0)::int`,
      grossStripe: sql<number>`coalesce(sum(${donations.grossAmountCents}) filter (where ${s("succeeded")} and ${donations.source} = 'stripe'), 0)::int`,
      succeededStripe: sql<number>`count(*) filter (where ${s("succeeded")} and ${donations.source} = 'stripe')::int`,
    })
    .from(donations)
    .where(eq(donations.campaignId, campaignId));

  const succeeded = r?.succeeded ?? 0;
  const succeededStripe = r?.succeededStripe ?? 0;
  // Stripe's fee is percent-of-gross plus a fixed amount PER CHARGE, and only on
  // gifts that actually went through Stripe. The percent part sums linearly; the
  // fixed part is added once per such gift.
  const est = succeededStripe > 0 ? estimatedStripeFee(r!.grossStripe) + (succeededStripe - 1) * estimatedStripeFee(0) : 0;
  return {
    raisedCents: r?.raised ?? 0,
    grossCents: r?.gross ?? 0,
    feeCoveredCents: r?.feeCovered ?? 0,
    platformFeeCents: r?.platformFee ?? 0,
    refundedCents: r?.refunded ?? 0,
    importedCents: r?.imported ?? 0,
    estimatedStripeFeeCents: est,
    estimatedNetCents: (r?.gross ?? 0) - est,
    counts: {
      succeeded,
      pending: r?.pending ?? 0,
      refunded: r?.refundedN ?? 0,
      partially_refunded: r?.partial ?? 0,
      failed: r?.failed ?? 0,
      disputed: r?.disputed ?? 0,
    },
    feeCoverRate: succeeded > 0 ? (r!.covered ?? 0) / succeeded : 0,
  };
}
