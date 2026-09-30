/**
 * Loads a roster and its donation history from a previous campaign.
 *
 * Every participant becomes a row owned by a PLACEHOLDER user — a reserved
 * `.invalid` address that can never sign in — so the real person later claims
 * it through an invite and inherits their page, links and totals instead of
 * getting a duplicate. Donations are recorded with source = 'import': they
 * count toward what was raised and are excluded from Stripe fee estimates,
 * because they never went through this site's Stripe.
 *
 * The payload may carry expected per-participant counts and totals. If it
 * does, they are reconciled BEFORE anything is written, and a mismatch aborts.
 */
import { and, eq, like } from "drizzle-orm";
import { z } from "zod";
import { db } from "./db";
import { campaigns, users, participants, donations, outreachEvents } from "./db/schema";
import { encryptField, encryptOptional, CTX } from "./crypto";
import { uniqueParticipantSlug } from "./queries/participants";
import { ensurePersonalShareLink } from "./sharing";
import { joinCode, slugify } from "./ids";
import { audit } from "./audit";

const DAY = 86_400_000;

export const RosterImport = z.object({
  campaign: z.object({
    slug: z.string().trim().min(2).max(80).regex(/^[a-z0-9-]+$/, "slug must be lowercase letters, digits and dashes"),
    name: z.string().trim().min(2).max(120),
    goalCents: z.number().int().min(0).default(0),
    startedDaysAgo: z.number().int().min(0).max(3650).default(10),
    description: z.string().trim().max(5000).optional(),
  }),
  participants: z
    .array(
      z.object({
        name: z.string().trim().min(2).max(80),
        emailsSent: z.number().int().min(0).max(10_000).default(0),
        textsSent: z.number().int().min(0).max(10_000).default(0),
        expectedDonations: z.number().int().min(0).optional(),
        expectedRaised: z.number().min(0).optional(),
        rosterNumber: z.string().trim().max(4).optional(),
        teamRole: z.string().trim().max(40).optional(),
        classYear: z.string().trim().max(12).optional(),
        /** Site-relative (/roster/x.jpg) or https. */
        photoUrl: z.string().trim().max(500).regex(/^(\/[^\s]*|https:\/\/[^\s]+)$/).optional(),
      }),
    )
    .min(1),
  donations: z.array(
    z.object({
      participant: z.string().trim().min(1),
      /** Whole dollars, as it appears on a donor wall. */
      amount: z.number().positive(),
      donor: z.string().trim().min(1).max(120).nullable(),
      daysAgo: z.number().int().min(0).max(3650),
      message: z.string().trim().max(500).optional(),
      inferred: z.boolean().optional(),
    }),
  ),
});
export type RosterImport = z.infer<typeof RosterImport>;

export type ImportSummary = {
  campaignId: string;
  campaignSlug: string;
  participants: number;
  donations: number;
  totalCents: number;
  outreachEvents: number;
  replaced: boolean;
  claimedRowsDropped: number;
};

export class ReconciliationError extends Error {
  constructor(public readonly problems: string[]) {
    super(`Reconciliation failed:\n  - ${problems.join("\n  - ")}`);
    this.name = "ReconciliationError";
  }
}

/** Compare the payload's expectations with what its donations actually sum to. Pure. */
export function reconcile(payload: RosterImport): string[] {
  const byName = new Map<string, { n: number; cents: number }>();
  for (const d of payload.donations) {
    const cur = byName.get(d.participant) ?? { n: 0, cents: 0 };
    cur.n += 1;
    cur.cents += Math.round(d.amount * 100);
    byName.set(d.participant, cur);
  }
  const problems: string[] = [];
  const names = new Set(payload.participants.map((p) => p.name));
  for (const d of payload.donations) {
    if (!names.has(d.participant)) problems.push(`donation for unknown participant "${d.participant}"`);
  }
  for (const p of payload.participants) {
    const got = byName.get(p.name) ?? { n: 0, cents: 0 };
    if (p.expectedDonations !== undefined && got.n !== p.expectedDonations) {
      problems.push(`${p.name}: expected ${p.expectedDonations} donations, payload has ${got.n}`);
    }
    if (p.expectedRaised !== undefined && got.cents !== Math.round(p.expectedRaised * 100)) {
      problems.push(`${p.name}: expected $${p.expectedRaised}, payload sums to $${(got.cents / 100).toFixed(2)}`);
    }
  }
  const seen = new Set<string>();
  for (const p of payload.participants) {
    if (seen.has(p.name)) problems.push(`duplicate participant "${p.name}"`);
    seen.add(p.name);
  }
  return problems;
}

const placeholderClerkId = (campaignSlug: string, participantSlug: string) => `import:${campaignSlug}:${participantSlug}`;
export const isPlaceholderEmail = (email: string) => email.endsWith(".import.invalid");

export async function importRoster(
  raw: unknown,
  opts: { orgId: string; replace?: boolean; now?: Date; platformFeeBps?: number },
): Promise<ImportSummary> {
  const payload = RosterImport.parse(raw);
  const problems = reconcile(payload);
  if (problems.length) throw new ReconciliationError(problems);

  const now = opts.now ?? new Date();
  const slug = payload.campaign.slug;

  const [existing] = await db
    .select({ id: campaigns.id })
    .from(campaigns)
    .where(and(eq(campaigns.orgId, opts.orgId), eq(campaigns.slug, slug)))
    .limit(1);

  let claimedRowsDropped = 0;
  if (existing) {
    if (!opts.replace) {
      throw new Error(`Campaign "${slug}" already exists. Re-run with --replace to wipe it and load again.`);
    }
    // Rows a real person has already claimed go with the campaign. Count them so the operator knows.
    const claimed = await db
      .select({ id: participants.id })
      .from(participants)
      .innerJoin(users, eq(participants.userId, users.id))
      .where(and(eq(participants.campaignId, existing.id), eq(users.isPlaceholder, false)));
    claimedRowsDropped = claimed.length;

    await db.delete(campaigns).where(eq(campaigns.id, existing.id));
    await db.delete(users).where(and(eq(users.isPlaceholder, true), like(users.clerkUserId, `${placeholderClerkId(slug, "")}%`)));
  }

  const [campaign] = await db
    .insert(campaigns)
    .values({
      orgId: opts.orgId,
      slug,
      name: payload.campaign.name,
      description: payload.campaign.description ?? null,
      goalCents: payload.campaign.goalCents,
      startsAt: new Date(now.getTime() - payload.campaign.startedDaysAgo * DAY),
      status: "active",
      platformFeeBps: opts.platformFeeBps ?? 0,
      joinCode: joinCode(),
    })
    .returning();

  const idByName = new Map<string, string>();
  let outreachCount = 0;

  for (const p of payload.participants) {
    const pslug = await uniqueParticipantSlug(campaign!.id, p.name);
    const [placeholder] = await db
      .insert(users)
      .values({
        clerkUserId: placeholderClerkId(slug, pslug),
        email: `${pslug}@${slugify(slug)}.import.invalid`,
        name: p.name,
        isPlaceholder: true,
      })
      .returning();
    const [participant] = await db
      .insert(participants)
      .values({
        campaignId: campaign!.id,
        userId: placeholder!.id,
        slug: pslug,
        displayName: p.name,
        rosterNumber: p.rosterNumber ?? null,
        teamRole: p.teamRole ?? null,
        classYear: p.classYear ?? null,
        photoUrl: p.photoUrl ?? null,
        status: "active",
        joinedAt: campaign!.startsAt,
      })
      .returning();
    idByName.set(p.name, participant!.id);
    await ensurePersonalShareLink(participant!.id, campaign!.id);

    // Historical outreach counts, spread evenly across the campaign window.
    // No contact rows are fabricated: these events carry no recipient.
    const span = payload.campaign.startedDaysAgo * DAY;
    const events: (typeof outreachEvents.$inferInsert)[] = [];
    const total = p.emailsSent + p.textsSent;
    for (let i = 0; i < total; i += 1) {
      events.push({
        participantId: participant!.id,
        channel: i < p.emailsSent ? "email_manual" : "sms",
        occurredAt: new Date(now.getTime() - span + (span * (i + 1)) / (total + 1)),
      });
    }
    if (events.length) await db.insert(outreachEvents).values(events);
    outreachCount += events.length;
  }

  let totalCents = 0;
  const rows = payload.donations.map((d, i) => {
    const cents = Math.round(d.amount * 100);
    totalCents += cents;
    return {
      campaignId: campaign!.id,
      participantId: idByName.get(d.participant)!,
      grossAmountCents: cents,
      designatedAmountCents: cents,
      feeCoveredCents: 0,
      platformFeeCents: 0,
      donorNameCiphertext: d.donor ? encryptField(d.donor, CTX.donorName) : null,
      messageCiphertext: encryptOptional(d.message, CTX.donorMessage),
      isAnonymous: d.donor === null,
      status: "succeeded" as const,
      source: "import" as const,
      // Same-day gifts get distinct, daytime-ish timestamps so the wall orders sensibly.
      createdAt: new Date(now.getTime() - d.daysAgo * DAY - (i % 20) * 23 * 60_000),
    };
  });
  if (rows.length) await db.insert(donations).values(rows);

  await audit({
    action: "roster.import",
    targetType: "campaign",
    targetId: campaign!.id,
    orgId: opts.orgId,
    metadata: {
      participant_count: payload.participants.length,
      donation_count: rows.length,
      total_cents: totalCents,
      outreach_events: outreachCount,
      replaced: Boolean(existing),
      claimed_rows_dropped: claimedRowsDropped,
    },
  });

  return {
    campaignId: campaign!.id,
    campaignSlug: slug,
    participants: payload.participants.length,
    donations: rows.length,
    totalCents,
    outreachEvents: outreachCount,
    replaced: Boolean(existing),
    claimedRowsDropped,
  };
}
