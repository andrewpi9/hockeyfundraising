import { and, eq } from "drizzle-orm";
import { db } from "./db";
import { participants, type Campaign, type Participant, type User } from "./db/schema";
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
