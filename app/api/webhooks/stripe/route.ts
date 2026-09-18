import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { webhookEvents } from "@/lib/db/schema";
import { getStripe } from "@/lib/stripe";
import { processStripeEvent } from "@/lib/stripe-events";

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

  const inserted = await db
    .insert(webhookEvents)
    .values({ provider: "stripe", eventId: event.id, type: event.type })
    .onConflictDoNothing()
    .returning({ id: webhookEvents.id });
  if (inserted.length === 0) return NextResponse.json({ received: true, duplicate: true });
  const ledgerId = inserted[0]!.id;

  try {
    const outcome = await processStripeEvent(event);
    await db
      .update(webhookEvents)
      .set({ status: outcome === "ignored" ? "ignored" : "processed", processedAt: new Date() })
      .where(and(eq(webhookEvents.id, ledgerId), eq(webhookEvents.status, "received")));
    return NextResponse.json({ received: true, outcome });
  } catch (err) {
    // A 500 makes Stripe retry with backoff — right for a transient DB failure.
    // The ledger row is released so the retry is not treated as a duplicate.
    await db.delete(webhookEvents).where(eq(webhookEvents.id, ledgerId));
    console.error(`[stripe] ${event.type} failed:`, err instanceof Error ? err.message : "unknown");
    return NextResponse.json({ error: "Handler failed" }, { status: 500 });
  }
}
