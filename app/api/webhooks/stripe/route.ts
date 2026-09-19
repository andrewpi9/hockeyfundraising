import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { getStripe } from "@/lib/stripe";
import { processStripeEvent } from "@/lib/stripe-events";
import { claimWebhookEvent, settleWebhookEvent, failWebhookEvent } from "@/lib/webhook-ledger";

/**
 * Only two things happen here: the signature is checked against the org's
 * webhook secret, and the event id is written to the replay ledger. Money logic
 * lives in lib/stripe-events so it can be tested without Stripe.
 *
 * The signature covers the exact bytes Stripe sent — never put a JSON body
 * parser in front of this.
 */
export async function POST(req: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "Not configured" }, { status: 500 });

  const signature = req.headers.get("stripe-signature");
  if (!signature) return NextResponse.json({ error: "Missing signature" }, { status: 400 });

  const raw = await req.text();
  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(raw, signature, secret);
  } catch {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  const ledgerId = await claimWebhookEvent("stripe", event.id, event.type);
  if (!ledgerId) return NextResponse.json({ received: true, duplicate: true });

  try {
    const outcome = await processStripeEvent(event);
    await settleWebhookEvent(ledgerId, outcome === "ignored" ? "ignored" : "processed");
    return NextResponse.json({ received: true, outcome });
  } catch (err) {
    // A 500 makes Stripe retry with backoff — right for a transient DB failure.
    // The row is marked failed (never deleted) so the retry can re-claim it.
    await failWebhookEvent(ledgerId, err);
    console.error(`[stripe] ${event.type} failed:`, err instanceof Error ? err.message : "unknown");
    return NextResponse.json({ error: "Handler failed" }, { status: 500 });
  }
}
