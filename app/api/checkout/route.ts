import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { donations, participants, shareLinks } from "@/lib/db/schema";
import { stripe, siteUrl } from "@/lib/stripe";
import { getActiveCampaign } from "@/lib/queries";
import {
  feeForAmount,
  formatMoney,
  MIN_DONATION_CENTS,
  MAX_DONATION_CENTS,
} from "@/lib/money";
import { rateLimit, clientIp, verifyTurnstile } from "@/lib/ratelimit";

const Body = z.object({
  amountCents: z.number().int().min(MIN_DONATION_CENTS).max(MAX_DONATION_CENTS),
  coverFee: z.boolean(),
  participantSlug: z.string().max(64).optional(),
  ref: z.string().max(32).optional(),
  donorName: z.string().trim().max(120).optional(),
  donorEmail: z.email().max(200),
  message: z.string().trim().max(500).optional(),
  isAnonymous: z.boolean().default(false),
  turnstileToken: z.string().optional(),
});

export async function POST(req: Request) {
  const ip = clientIp(req);
  const limited = rateLimit(`checkout:${ip}`, 8, 60_000);
  if (!limited.ok) {
    return NextResponse.json(
      { error: "Too many attempts. Please wait a minute and try again." },
      { status: 429 },
    );
  }

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request." },
      { status: 400 },
    );
  }
  const input = parsed.data;

  if (!(await verifyTurnstile(input.turnstileToken, ip))) {
    return NextResponse.json({ error: "Verification failed." }, { status: 400 });
  }

  const campaign = await getActiveCampaign();
  if (!campaign) {
    return NextResponse.json(
      { error: "No fundraiser is currently running." },
      { status: 404 },
    );
  }

  // Attribution: an explicit ?ref= share code wins, because it also ties the
  // gift to the individual contact who was messaged. Fall back to the slug of
  // whichever player page the donor was on.
  let participantId: string | null = null;
  let shareLinkId: string | null = null;

  if (input.ref) {
    const [link] = await db
      .select()
      .from(shareLinks)
      .where(eq(shareLinks.code, input.ref))
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
      .where(
        and(
          eq(participants.campaignId, campaign.id),
          eq(participants.slug, input.participantSlug),
        ),
      )
      .limit(1);
    participantId = p?.id ?? null;
  }

  const feeCoveredCents = input.coverFee ? feeForAmount(input.amountCents) : 0;
  const totalChargedCents = input.amountCents + feeCoveredCents;

  const [donation] = await db
    .insert(donations)
    .values({
      campaignId: campaign.id,
      participantId,
      shareLinkId,
      amountCents: input.amountCents,
      feeCoveredCents,
      totalChargedCents,
      donorName: input.donorName || null,
      donorEmail: input.donorEmail,
      message: input.message || null,
      isAnonymous: input.isAnonymous,
      status: "pending",
    })
    .returning();

  if (!donation) {
    return NextResponse.json({ error: "Could not start checkout." }, { status: 500 });
  }

  const lineItems: {
    quantity: number;
    price_data: {
      currency: string;
      unit_amount: number;
      product_data: { name: string; description?: string };
    };
  }[] = [
    {
      quantity: 1,
      price_data: {
        currency: "usd",
        unit_amount: input.amountCents,
        product_data: {
          name: `Donation to ${campaign.name}`,
          description: "Tax-deductible contribution",
        },
      },
    },
  ];

  if (feeCoveredCents > 0) {
    lineItems.push({
      quantity: 1,
      price_data: {
        currency: "usd",
        unit_amount: feeCoveredCents,
        product_data: {
          name: "Processing fee covered",
          description: `Keeps the full ${formatMoney(input.amountCents)} with the team`,
        },
      },
    });
  }

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      submit_type: "donate",
      line_items: lineItems,
      customer_email: input.donorEmail,
      client_reference_id: donation.id,
      // The webhook trusts only this. Never read amounts back from the client.
      metadata: { donationId: donation.id, campaignId: campaign.id },
      payment_intent_data: {
        metadata: { donationId: donation.id },
        description: `${campaign.name} donation`,
      },
      success_url: siteUrl("/thanks?session_id={CHECKOUT_SESSION_ID}"),
      cancel_url: siteUrl(
        input.participantSlug ? `/p/${input.participantSlug}` : "/",
      ),
    });

    await db
      .update(donations)
      .set({ stripeSessionId: session.id })
      .where(eq(donations.id, donation.id));

    return NextResponse.json({ url: session.url });
  } catch (err) {
    console.error("Stripe checkout failed", err);
    return NextResponse.json(
      { error: "Payment could not be started. Please try again." },
      { status: 502 },
    );
  }
}
