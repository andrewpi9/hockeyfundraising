import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { participants, donations, campaigns, type Participant } from "@/lib/db/schema";
import type { LeaderboardRow } from "@/components/Leaderboard";

const SUCCEEDED = eq(donations.status, "succeeded");

/** Public leaderboard for one campaign. No PII: display names and totals only. */
export async function listParticipantsWithTotals(campaignId: string): Promise<LeaderboardRow[]> {
  return db
    .select({
      id: participants.id,
      slug: participants.slug,
      displayName: participants.displayName,
      photoUrl: participants.photoUrl,
      teamRole: participants.teamRole,
      rosterNumber: participants.rosterNumber,
      goalCents: participants.goalCents,
      raisedCents: sql<number>`coalesce(sum(${donations.designatedAmountCents}) filter (where ${SUCCEEDED}), 0)::int`,
      donorCount: sql<number>`count(${donations.id}) filter (where ${SUCCEEDED})::int`,
    })
    .from(participants)
    .leftJoin(donations, eq(donations.participantId, participants.id))
    .where(and(eq(participants.campaignId, campaignId), eq(participants.status, "active")))
    .groupBy(participants.id)
    .orderBy(
      desc(sql`coalesce(sum(${donations.designatedAmountCents}) filter (where ${SUCCEEDED}), 0)`),
      participants.displayName,
    );
}

export async function getParticipantBySlug(campaignId: string, slug: string): Promise<Participant | null> {
  const [row] = await db
    .select()
    .from(participants)
    .where(and(eq(participants.campaignId, campaignId), eq(participants.slug, slug), eq(participants.status, "active")))
    .limit(1);
  return row ?? null;
}

/** Every campaign the user is an active participant in, newest first. */
export async function listMyParticipations(userId: string) {
  return db
    .select({ participant: participants, campaign: campaigns })
    .from(participants)
    .innerJoin(campaigns, eq(participants.campaignId, campaigns.id))
    .where(and(eq(participants.userId, userId), eq(participants.status, "active")))
    .orderBy(desc(participants.joinedAt));
}

// ---------------------------------------------------------------- phase 2

import { shareLinks, participantInvites, users } from "@/lib/db/schema";
import { slugify } from "@/lib/ids";
import { gt, isNull } from "drizzle-orm";

export async function uniqueParticipantSlug(campaignId: string, name: string): Promise<string> {
  const base = slugify(name) || "participant";
  for (let i = 1; i < 100; i += 1) {
    const candidate = i === 1 ? base : `${base}-${i}`;
    const [clash] = await db
      .select({ id: participants.id })
      .from(participants)
      .where(and(eq(participants.campaignId, campaignId), eq(participants.slug, candidate)))
      .limit(1);
    if (!clash) return candidate;
  }
  throw new Error("Could not find a free slug");
}

const participantTotals = {
  raisedCents: sql<number>`(
    select coalesce(sum(d.designated_amount_cents), 0) from donations d
    where d.participant_id = "participants"."id" and d.status = 'succeeded'
  )::int`,
  donorCount: sql<number>`(
    select count(*) from donations d
    where d.participant_id = "participants"."id" and d.status = 'succeeded'
  )::int`,
  clickCount: sql<number>`(
    select coalesce(sum(s.click_count), 0) from share_links s
    where s.participant_id = "participants"."id"
  )::int`,
  contactCount: sql<number>`(
    select count(*) from contacts c where c.participant_id = "participants"."id"
  )::int`,
  sendCount: sql<number>`(
    (select count(*) from email_invites e where e.participant_id = "participants"."id" and e.status <> 'failed')
    + (select count(*) from outreach_events o where o.participant_id = "participants"."id" and o.channel in ('sms', 'email_manual'))
  )::int`,
};

/** Everything the participant's own console needs, in one round trip. */
export async function getParticipantConsole(participantId: string) {
  const [row] = await db
    .select({ participant: participants, campaign: campaigns, ...participantTotals })
    .from(participants)
    .innerJoin(campaigns, eq(participants.campaignId, campaigns.id))
    .where(eq(participants.id, participantId))
    .limit(1);
  if (!row) return null;

  const [link] = await db
    .select({ code: shareLinks.code })
    .from(shareLinks)
    .where(and(eq(shareLinks.participantId, participantId), eq(shareLinks.medium, "personal"), isNull(shareLinks.contactId)))
    .limit(1);

  return { ...row, shareCode: link?.code ?? null };
}

/** Public participant page data. Null for removed participants and draft campaigns. */
export async function getParticipantPublic(campaignId: string, slug: string) {
  const [row] = await db
    .select({ participant: participants, ...participantTotals })
    .from(participants)
    .where(and(eq(participants.campaignId, campaignId), eq(participants.slug, slug), eq(participants.status, "active")))
    .limit(1);
  return row ?? null;
}

/** Pending invites for the admin roster view. Emails come back encrypted; the caller masks. */
export async function listPendingInvites(campaignId: string) {
  return db
    .select({
      id: participantInvites.id,
      emailCiphertext: participantInvites.emailCiphertext,
      expiresAt: participantInvites.expiresAt,
      createdAt: participantInvites.createdAt,
    })
    .from(participantInvites)
    .where(and(eq(participantInvites.campaignId, campaignId), isNull(participantInvites.acceptedAt), gt(participantInvites.expiresAt, new Date())))
    .orderBy(desc(participantInvites.createdAt));
}

/** Admin roster: active participants with totals, plus whether the row is still an unclaimed import. */
export async function listRoster(campaignId: string) {
  return db
    .select({ participant: participants, unclaimed: users.isPlaceholder, ...participantTotals })
    .from(participants)
    .innerJoin(users, eq(participants.userId, users.id))
    .where(and(eq(participants.campaignId, campaignId), eq(participants.status, "active")))
    .orderBy(desc(participantTotals.raisedCents), participants.displayName);
}
