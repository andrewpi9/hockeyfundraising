/**
 * Applies a verified Stripe event to the database. Pure with respect to Stripe:
 * everything it needs is on the event, so it never calls the API and can be
 * exercised in tests with synthetic events. Signature verification and the
 * replay ledger are the route's job, not this file's.
 */
import type Stripe from "stripe";
import { and, eq } from "drizzle-orm";
import { db } from "./db";
import { donations, campaigns, organizations, participants } from "./db/schema";
import { decryptOptional, CTX } from "./crypto";
import { sendDonationReceipt } from "./email";
import { orgPostalAddress } from "./outreach";

export type Outcome = "processed" | "ignored" | "failed";

const idOf = (v: string | { id: string } | null | undefined): string | null =>
  typeof v === "string" ? v : (v?.id ?? null);

export async function processStripeEvent(event: Stripe.Event): Promise<Outcome> {
  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded":
      return handleSession(event.data.object);
    case "checkout.session.async_payment_failed":
      return markBySession(event.data.object, "failed");
    case "charge.refunded":
      return handleRefund(event.data.object);
    case "charge.dispute.created":
      return handleDispute(event.data.object);
    default:
      return "ignored";
  }
}

async function loadPending(session: Stripe.Checkout.Session) {
  const donationId = session.metadata?.donationId ?? session.client_reference_id;
  if (!donationId) return null;
  // Both must match: the id we put in metadata AND the session id we stored
  // when we created it. Either alone could be a guess; together they are not.
  const [row] = await db
    .select()
    .from(donations)
    .where(and(eq(donations.id, donationId), eq(donations.stripeCheckoutSessionId, session.id)))
    .limit(1);
  return row ?? null;
}

async function handleSession(session: Stripe.Checkout.Session): Promise<Outcome> {
  const donation = await loadPending(session);
  if (!donation) return "ignored";
  if (donation.status !== "pending") return "ignored"; // already settled; at-least-once delivery

  const paymentIntentId = idOf(session.payment_intent);
  const paymentMethodType = session.payment_method_types?.[0] ?? null;

  // The card was charged whatever Stripe says it was. If that is not what we
  // asked for, something is wrong and the safe state is failed, not succeeded.
  if (typeof session.amount_total !== "number" || session.amount_total !== donation.grossAmountCents) {
    await db
      .update(donations)
      .set({ status: "failed", stripePaymentIntentId: paymentIntentId, updatedAt: new Date() })
      .where(eq(donations.id, donation.id));
    console.error(`[stripe] amount mismatch on donation ${donation.id}: expected ${donation.grossAmountCents}, got ${session.amount_total}`);
    return "processed";
  }

  if (session.payment_status !== "paid") {
    // Bank debits settle later; async_payment_succeeded will finish this.
    await db
      .update(donations)
      .set({ stripePaymentIntentId: paymentIntentId, paymentMethodType, updatedAt: new Date() })
      .where(eq(donations.id, donation.id));
    return "processed";
  }

  const updated = await db
    .update(donations)
    .set({ status: "succeeded", stripePaymentIntentId: paymentIntentId, paymentMethodType, updatedAt: new Date() })
    .where(and(eq(donations.id, donation.id), eq(donations.status, "pending")))
    .returning({ id: donations.id });
  if (updated.length === 0) return "ignored";

  await sendReceipt(donation.id).catch((err) => {
    // The gift is recorded either way; a receipt can be re-sent by hand.
    console.error(`[stripe] receipt failed for donation ${donation.id}:`, err instanceof Error ? err.message : "unknown");
  });
  return "processed";
}

async function markBySession(session: Stripe.Checkout.Session, status: "failed"): Promise<Outcome> {
  const donation = await loadPending(session);
  if (!donation || donation.status !== "pending") return "ignored";
  await db.update(donations).set({ status, updatedAt: new Date() }).where(eq(donations.id, donation.id));
  return "processed";
}

async function handleRefund(charge: Stripe.Charge): Promise<Outcome> {
  const paymentIntentId = idOf(charge.payment_intent);
  if (!paymentIntentId) return "ignored";
  const [donation] = await db.select().from(donations).where(eq(donations.stripePaymentIntentId, paymentIntentId)).limit(1);
  if (!donation) return "ignored";

  const refunded = charge.amount_refunded;
  const status = refunded >= donation.grossAmountCents ? "refunded" : refunded > 0 ? "partially_refunded" : donation.status;
  await db
    .update(donations)
    .set({ status, refundedAmountCents: refunded, stripeChargeId: charge.id, updatedAt: new Date() })
    .where(eq(donations.id, donation.id));
  return "processed";
}

async function handleDispute(dispute: Stripe.Dispute): Promise<Outcome> {
  const paymentIntentId = idOf(dispute.payment_intent);
  if (!paymentIntentId) return "ignored";
  const [donation] = await db.select({ id: donations.id }).from(donations).where(eq(donations.stripePaymentIntentId, paymentIntentId)).limit(1);
  if (!donation) return "ignored";
  await db
    .update(donations)
    .set({ status: "disputed", stripeChargeId: idOf(dispute.charge), updatedAt: new Date() })
    .where(eq(donations.id, donation.id));
  return "processed";
}

/** Decrypts the donor's address for the one legitimate reason: sending them their receipt. */
async function sendReceipt(donationId: string): Promise<void> {
  const [row] = await db
    .select({ donation: donations, campaign: campaigns, org: organizations, participantName: participants.displayName })
    .from(donations)
    .innerJoin(campaigns, eq(donations.campaignId, campaigns.id))
    .innerJoin(organizations, eq(campaigns.orgId, organizations.id))
    .leftJoin(participants, eq(donations.participantId, participants.id))
    .where(eq(donations.id, donationId))
    .limit(1);
  if (!row) return;

  const to = decryptOptional(row.donation.donorEmailCiphertext, CTX.donorEmail);
  if (!to) return;

  await sendDonationReceipt({
    to,
    donorName: decryptOptional(row.donation.donorNameCiphertext, CTX.donorName),
    amountCents: row.donation.designatedAmountCents,
    feeCoveredCents: row.donation.feeCoveredCents,
    campaignName: row.campaign.name,
    participantName: row.participantName,
    donationId: row.donation.id,
    org: { legalName: row.org.legalName ?? row.org.name, ein: row.org.ein, address: orgPostalAddress(row.org) },
  });
  await db.update(donations).set({ receiptSentAt: new Date() }).where(eq(donations.id, donationId));
}
