import { and, eq, ne } from "drizzle-orm";
import { db } from "./db";
import { participants, users, type Campaign, type Participant, type User } from "./db/schema";
import { uniqueParticipantSlug } from "./queries/participants";
import { ensurePersonalShareLink } from "./sharing";
import { AuthError } from "./authz";

/**
 * Idempotent: returns the existing active row if the user is already in the
 * campaign. A participant the admin removed stays removed — rejoining is the
 * admin's call, not the participant's.
 */
export async function createParticipantForUser(user: User, campaign: Campaign): Promise<Participant> {
  const [existing] = await db
    .select()
    .from(participants)
    .where(and(eq(participants.campaignId, campaign.id), eq(participants.userId, user.id)))
    .limit(1);

  if (existing?.status === "active") return existing;
  if (existing?.status === "removed") {
    throw new AuthError("FORBIDDEN", "You were removed from this campaign. Ask your coach to re-add you.");
  }

  const displayName = user.name?.trim() || user.email.split("@")[0] || "Participant";
  const slug = await uniqueParticipantSlug(campaign.id, displayName);

  const [created] = existing
    ? await db
        .update(participants)
        .set({ status: "active", joinedAt: new Date(), updatedAt: new Date() })
        .where(eq(participants.id, existing.id))
        .returning()
    : await db
        .insert(participants)
        .values({ campaignId: campaign.id, userId: user.id, slug, displayName, status: "active" })
        .returning();

  await ensurePersonalShareLink(created!.id, campaign.id);
  return created!;
}

/**
 * An imported roster row belongs to a placeholder user until the real person
 * accepts an invite that names it. Claiming moves the row to the real user and
 * deletes the placeholder, so history (donations, links, clicks) is preserved
 * and no duplicate participant is created.
 */
export async function claimParticipantForUser(user: User, participantId: string): Promise<Participant> {
  const [row] = await db
    .select({ participant: participants, owner: users })
    .from(participants)
    .innerJoin(users, eq(participants.userId, users.id))
    .where(eq(participants.id, participantId))
    .limit(1);
  if (!row) throw new AuthError("FORBIDDEN", "That roster entry no longer exists.");
  if (row.participant.userId === user.id) return row.participant;
  if (!row.owner.isPlaceholder) {
    throw new AuthError("FORBIDDEN", "That roster entry already belongs to someone.");
  }

  const [elsewhere] = await db
    .select({ id: participants.id })
    .from(participants)
    .where(and(eq(participants.campaignId, row.participant.campaignId), eq(participants.userId, user.id), ne(participants.id, participantId)))
    .limit(1);
  if (elsewhere) {
    throw new AuthError("FORBIDDEN", "You already have a page in this campaign. Ask your coach to remove one of them.");
  }

  // Reassign first, then remove the placeholder. Doing it the other way round
  // would cascade-delete the participant row along with its history.
  const [claimed] = await db
    .update(participants)
    .set({ userId: user.id, status: "active", joinedAt: new Date(), updatedAt: new Date() })
    .where(eq(participants.id, participantId))
    .returning();
  await db.delete(users).where(and(eq(users.id, row.owner.id), eq(users.isPlaceholder, true)));

  await ensurePersonalShareLink(claimed!.id, claimed!.campaignId);
  return claimed!;
}
