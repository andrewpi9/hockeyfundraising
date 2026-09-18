import { and, desc, eq, sql, isNotNull } from "drizzle-orm";
import { db } from "./db";
import {
  campaigns,
  participants,
  donations,
  contacts,
  shareLinks,
  outreach,
  users,
} from "./db/schema";

const SUCCEEDED = eq(donations.status, "succeeded");

export async function getActiveCampaign() {
  const [row] = await db
    .select()
    .from(campaigns)
    .where(eq(campaigns.isActive, true))
    .orderBy(desc(campaigns.createdAt))
    .limit(1);
  return row ?? null;
}

export async function getCampaignTotals(campaignId: string) {
  const [row] = await db
    .select({
      raisedCents: sql<number>`coalesce(sum(${donations.amountCents}), 0)::int`,
      feesCoveredCents: sql<number>`coalesce(sum(${donations.feeCoveredCents}), 0)::int`,
      donationCount: sql<number>`count(*)::int`,
      donorCount: sql<number>`count(distinct coalesce(${donations.donorEmail}, ${donations.id}::text))::int`,
    })
    .from(donations)
    .where(and(eq(donations.campaignId, campaignId), SUCCEEDED));

  return (
    row ?? {
      raisedCents: 0,
      feesCoveredCents: 0,
      donationCount: 0,
      donorCount: 0,
    }
  );
}

export type LeaderboardRow = Awaited<ReturnType<typeof getLeaderboard>>[number];

export async function getLeaderboard(campaignId: string) {
  return db
    .select({
      id: participants.id,
      slug: participants.slug,
      displayName: participants.displayName,
      photoUrl: participants.photoUrl,
      jerseyNumber: participants.jerseyNumber,
      position: participants.position,
      goalCents: participants.goalCents,
      raisedCents: sql<number>`coalesce(sum(${donations.amountCents}) filter (where ${SUCCEEDED}), 0)::int`,
      donorCount: sql<number>`count(${donations.id}) filter (where ${SUCCEEDED})::int`,
    })
    .from(participants)
    .leftJoin(donations, eq(donations.participantId, participants.id))
    .where(eq(participants.campaignId, campaignId))
    .groupBy(participants.id)
    .orderBy(
      desc(sql`coalesce(sum(${donations.amountCents}) filter (where ${SUCCEEDED}), 0)`),
      participants.displayName,
    );
}

export async function getParticipantBySlug(campaignId: string, slug: string) {
  const [row] = await db
    .select()
    .from(participants)
    .where(and(eq(participants.campaignId, campaignId), eq(participants.slug, slug)))
    .limit(1);
  return row ?? null;
}

export async function getParticipantTotals(participantId: string) {
  const [row] = await db
    .select({
      raisedCents: sql<number>`coalesce(sum(${donations.amountCents}), 0)::int`,
      donorCount: sql<number>`count(*)::int`,
    })
    .from(donations)
    .where(and(eq(donations.participantId, participantId), SUCCEEDED));
  return row ?? { raisedCents: 0, donorCount: 0 };
}

/** Public donor wall. Anonymous gifts keep their amount and message but lose the name. */
export async function getRecentDonations(
  campaignId: string,
  opts: { participantId?: string; limit?: number } = {},
) {
  const where = [eq(donations.campaignId, campaignId), SUCCEEDED];
  if (opts.participantId) where.push(eq(donations.participantId, opts.participantId));

  const rows = await db
    .select({
      id: donations.id,
      amountCents: donations.amountCents,
      donorName: donations.donorName,
      message: donations.message,
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
    ...r,
    donorName: r.isAnonymous ? null : r.donorName,
  }));
}

/** Per-player outreach funnel for the player console and the coach dashboard. */
export async function getParticipantActivity(participantId: string) {
  const [contactStats] = await db
    .select({
      total: sql<number>`count(*)::int`,
      withEmail: sql<number>`count(*) filter (where ${contacts.email} is not null)::int`,
      withPhone: sql<number>`count(*) filter (where ${contacts.phone} is not null)::int`,
      contacted: sql<number>`count(*) filter (where ${contacts.lastContactedAt} is not null)::int`,
    })
    .from(contacts)
    .where(eq(contacts.participantId, participantId));

  const [linkStats] = await db
    .select({
      clicks: sql<number>`coalesce(sum(${shareLinks.clickCount}), 0)::int`,
    })
    .from(shareLinks)
    .where(eq(shareLinks.participantId, participantId));

  const [sendStats] = await db
    .select({ sends: sql<number>`count(*)::int` })
    .from(outreach)
    .innerJoin(contacts, eq(outreach.contactId, contacts.id))
    .where(eq(contacts.participantId, participantId));

  return {
    contacts: contactStats ?? { total: 0, withEmail: 0, withPhone: 0, contacted: 0 },
    clicks: linkStats?.clicks ?? 0,
    sends: sendStats?.sends ?? 0,
  };
}

/** Donor list for thank-you notes. Admin-only: contains email addresses. */
export async function getDonorExport(campaignId: string) {
  return db
    .select({
      createdAt: donations.createdAt,
      donorName: donations.donorName,
      donorEmail: donations.donorEmail,
      amountCents: donations.amountCents,
      feeCoveredCents: donations.feeCoveredCents,
      totalChargedCents: donations.totalChargedCents,
      isAnonymous: donations.isAnonymous,
      message: donations.message,
      participantName: participants.displayName,
      stripePaymentIntentId: donations.stripePaymentIntentId,
    })
    .from(donations)
    .leftJoin(participants, eq(donations.participantId, participants.id))
    .where(and(eq(donations.campaignId, campaignId), SUCCEEDED))
    .orderBy(desc(donations.createdAt));
}

export async function getRosterWithActivity(campaignId: string) {
  return db
    .select({
      id: participants.id,
      slug: participants.slug,
      displayName: participants.displayName,
      goalCents: participants.goalCents,
      email: users.email,
      raisedCents: sql<number>`coalesce(sum(${donations.amountCents}) filter (where ${SUCCEEDED}), 0)::int`,
      donorCount: sql<number>`count(${donations.id}) filter (where ${SUCCEEDED})::int`,
      contactCount: sql<number>`(select count(*) from ${contacts} where ${contacts.participantId} = ${participants.id})::int`,
      sendCount: sql<number>`(select count(*) from ${outreach} inner join ${contacts} on ${outreach.contactId} = ${contacts.id} where ${contacts.participantId} = ${participants.id})::int`,
      clickCount: sql<number>`(select coalesce(sum(${shareLinks.clickCount}), 0) from ${shareLinks} where ${shareLinks.participantId} = ${participants.id})::int`,
    })
    .from(participants)
    .innerJoin(users, eq(participants.userId, users.id))
    .leftJoin(donations, eq(donations.participantId, participants.id))
    .where(eq(participants.campaignId, campaignId))
    .groupBy(participants.id, users.email)
    .orderBy(
      desc(sql`coalesce(sum(${donations.amountCents}) filter (where ${SUCCEEDED}), 0)`),
    );
}

/** Gifts that came in without a player attached — shared straight from the team page. */
export async function getUnattributedTotal(campaignId: string) {
  const [row] = await db
    .select({ cents: sql<number>`coalesce(sum(${donations.amountCents}), 0)::int` })
    .from(donations)
    .where(
      and(
        eq(donations.campaignId, campaignId),
        SUCCEEDED,
        sql`${donations.participantId} is null`,
      ),
    );
  return row?.cents ?? 0;
}

export { isNotNull };
