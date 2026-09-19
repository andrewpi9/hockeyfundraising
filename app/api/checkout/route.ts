import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { donations, participants, shareLinks } from "@/lib/db/schema";
import { getStripe, paymentsConfigured } from "@/lib/stripe";
import { siteUrl } from "@/lib/site";
import { CheckoutInput } from "@/lib/checkout-schema";
import { feeForAmount, platformFeeFor, formatMoney } from "@/lib/money";
import { encryptOptional, blindIndex, CTX } from "@/lib/crypto";
import { limiters, clientIp, tooMany } from "@/lib/ratelimit";
import { verifyTurnstile } from "@/lib/turnstile";
import { getOrg, getPublicCampaignBySlug } from "@/lib/queries/campaigns";

/**
 * Creates a Stripe Checkout Session on the ORG's account. Card details never
 * touch this server. The donation row is written `pending` first; only the
 * signed webhook promotes it, so nothing here can mint a "succeeded" gift.
 */
export async function POST(req: Request) {
  if (!paymentsConfigured()) {
    return NextResponse.json({ error: "Online donations aren't open yet. Check back soon." }, { status: 503 });
  }
  const ip = clientIp(req);
  const limit = await limiters.checkout.limit(ip);
  if (!limit.success) return tooMany(limit);

  const parsed = CheckoutInput.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request." }, { status: 400 });
  }
  const input = parsed.data;

  if (!(await verifyTurnstile(input.turnstileToken, ip))) {
    return NextResponse.json({ error: "Verification failed. Please try again." }, { status: 400 });
  }

  const org = await getOrg();
  const campaign = org ? await getPublicCampaignBySlug(org.id, input.campaignSlug) : null;
  if (!org || !campaign || campaign.status !== "active") {
    return NextResponse.json({ error: "This campaign is not accepting donations." }, { status: 404 });
  }

  // Attribution: a share code is the strongest signal — it names the exact link,
  // and through it the exact contact. Fall back to the participant page.
  let participantId: string | null = null;
  let shareLinkId: string | null = null;
  if (input.ref) {
    const [link] = await db
      .select({ id: shareLinks.id, participantId: shareLinks.participantId })
      .from(shareLinks)
      .innerJoin(participants, and(eq(shareLinks.participantId, participants.id), eq(participants.status, "active")))
      .where(and(eq(shareLinks.code, input.ref), eq(shareLinks.campaignId, campaign.id)))
      .limit(1);
    if (link) {
      shareLinkId = link.id;
      participantId = link.participantId;
    }
  }
  if (!participantId && input.participantSlug) {
    const [p] = await db
      .select({ id: participants.id })
      .from(participants)
      .where(and(eq(participants.campaignId, campaign.id), eq(participants.slug, input.participantSlug), eq(participants.status, "active")))
      .limit(1);
    participantId = p?.id ?? null;
  }

  // Money, computed here and only here. The client's preview is not consulted.
  const designated = input.amountCents;
  const feeCovered = input.coverFee && campaign.allowFeeCover ? feeForAmount(designated) : 0;
  const platformFee = platformFeeFor(designated, campaign.platformFeeBps);
  const gross = designated + feeCovered + platformFee;

  const [donation] = await db
    .insert(donations)
    .values({
      campaignId: campaign.id,
      participantId,
      shareLinkId,
      grossAmountCents: gross,
      designatedAmountCents: designated,
      feeCoveredCents: feeCovered,
      platformFeeCents: platformFee,
      // Stored even for anonymous gifts — the org still needs it for the receipt
      // and thank-you notes. Anonymity is a display rule, enforced in the query.
      donorNameCiphertext: encryptOptional(input.donorName, CTX.donorName),
      donorEmailCiphertext: encryptOptional(input.donorEmail, CTX.donorEmail),
      donorEmailBlindIndex: blindIndex("email", input.donorEmail),
      messageCiphertext: encryptOptional(input.message, CTX.donorMessage),
      isAnonymous: input.isAnonymous,
      status: "pending",
    })
    .returning({ id: donations.id });
  if (!donation) return NextResponse.json({ error: "Could not start checkout." }, { status: 500 });

  const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [
    {
      quantity: 1,
      price_data: {
        currency: "usd",
        unit_amount: designated,
        product_data: { name: `Donation — ${campaign.name}`, description: "Tax-deductible to the extent allowed by law" },
      },
    },
  ];
  if (feeCovered > 0) {
    lineItems.push({
      quantity: 1,
      price_data: {
        currency: "usd",
        unit_amount: feeCovered,
        product_data: { name: "Card processing, covered by you", description: `So the full ${formatMoney(designated)} reaches the program` },
      },
    });
  }
  if (platformFee > 0) {
    lineItems.push({
      quantity: 1,
      price_data: { currency: "usd", unit_amount: platformFee, product_data: { name: "Platform fee" } },
    });
  }

  const backTo = input.participantSlug ? `/c/${campaign.slug}/${input.participantSlug}` : `/c/${campaign.slug}`;

  try {
    const session = await getStripe().checkout.sessions.create({
      mode: "payment",
      submit_type: "donate",
      line_items: lineItems,
      customer_email: input.donorEmail,
      client_reference_id: donation.id,
      // The webhook trusts these two together with the stored session id.
      metadata: { donationId: donation.id, campaignId: campaign.id },
      payment_intent_data: { metadata: { donationId: donation.id }, description: `${campaign.name} donation` },
      success_url: siteUrl("/thanks?session_id={CHECKOUT_SESSION_ID}"),
      cancel_url: siteUrl(backTo),
    });

    await db.update(donations).set({ stripeCheckoutSessionId: session.id }).where(eq(donations.id, donation.id));
    return NextResponse.json({ url: session.url });
  } catch (err) {
    // Message only. The request body holds the donor's name and email.
    console.error("[checkout] Stripe session failed:", err instanceof Error ? err.message : "unknown");
    await db.update(donations).set({ status: "failed" }).where(eq(donations.id, donation.id));
    return NextResponse.json({ error: "Payment could not be started. Please try again." }, { status: 502 });
  }
}
