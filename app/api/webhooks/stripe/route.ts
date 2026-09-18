import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { eq, and } from "drizzle-orm";
import { db } from "@/lib/db";
import { donations, campaigns, participants } from "@/lib/db/schema";
import { stripe } from "@/lib/stripe";
import { sendDonationReceipt } from "@/lib/email";

// The signature is computed over the exact bytes Stripe sent, so this handler
// must read the raw body. Never add a JSON body parser in front of it.
export async function POST(req: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    console.error("STRIPE_WEBHOOK_SECRET is not set");
    return NextResponse.json({ error: "Not configured" }, { status: 500 });
  }

  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  const raw = await req.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(raw, signature, secret);
  } catch (err) {
    console.error("Webhook signature verification failed", err);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed":
        await handleCompleted(event.data.object);
        break;
      case "charge.refunded":
        await handleRefund(event.data.object);
        break;
      default:
        break;
    }
  } catch (err) {
    // A 500 makes Stripe retry with backoff, which is what we want for a
    // transient database or email failure.
    console.error(`Handler failed for ${event.type}`, err);
    return NextResponse.json({ error: "Handler failed" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

async function handleCompleted(session: Stripe.Checkout.Session) {
  const donationId = session.metadata?.donationId;
  if (!donationId) return;
  if (session.payment_status !== "paid") return;

  // Only a still-pending row is promoted, so Stripe's at-least-once delivery
  // cannot send a second receipt for the same gift.
  const updated = await db
    .update(donations)
    .set({
      status: "succeeded",
      stripePaymentIntentId:
        typeof session.payment_intent === "string"
          ? session.payment_intent
          : (session.payment_intent?.id ?? null),
    })
    .where(and(eq(donations.id, donationId), eq(donations.status, "pending")))
    .returning();

  const donation = updated[0];
  if (!donation) return;

  const [campaign] = await db
    .select({ name: campaigns.name })
    .from(campaigns)
    .where(eq(campaigns.id, donation.campaignId))
    .limit(1);

  let participantName: string | null = null;
  if (donation.participantId) {
    const [p] = await db
      .select({ displayName: participants.displayName })
      .from(participants)
      .where(eq(participants.id, donation.participantId))
      .limit(1);
    participantName = p?.displayName ?? null;
  }

  if (donation.donorEmail) {
    await sendDonationReceipt({
      to: donation.donorEmail,
      donorName: donation.donorName,
      amountCents: donation.amountCents,
      feeCoveredCents: donation.feeCoveredCents,
      campaignName: campaign?.name ?? "the team",
      participantName,
      donationId: donation.id,
    });
    await db
      .update(donations)
      .set({ receiptSentAt: new Date() })
      .where(eq(donations.id, donation.id));
  }
}

async function handleRefund(charge: Stripe.Charge) {
  const paymentIntentId =
    typeof charge.payment_intent === "string"
      ? charge.payment_intent
      : charge.payment_intent?.id;
  if (!paymentIntentId) return;

  // Partial refunds still leave the gift partly intact, but for a team
  // fundraiser the honest thing is to drop it off the total entirely and
  // let the treasurer reconcile the difference in Stripe.
  await db
    .update(donations)
    .set({ status: "refunded" })
    .where(eq(donations.stripePaymentIntentId, paymentIntentId));
}
