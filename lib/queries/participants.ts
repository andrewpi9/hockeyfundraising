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
