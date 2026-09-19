import { eq } from "drizzle-orm";
import { db } from "./db";
import { contacts, participants, campaigns, suppressions, participantHelpers } from "./db/schema";
import { audit } from "./audit";

export type SuppressionReason = "unsubscribed" | "bounced" | "complained" | "manual";

/**
 * Marks the recipient (a participant's contact, or a family helper) and adds the
 * address to the ORG-WIDE suppression list, so a person who opts out of one
 * participant's emails is not mailed by another. Idempotent. Never decrypts
 * the address: the stored blind index is enough.
 */
export async function applyUnsubscribe(recipientId: string, reason: SuppressionReason, ip?: string | null): Promise<boolean> {
  const [contact] = await db
    .select({ id: contacts.id, unsubscribedAt: contacts.unsubscribedAt, emailBlindIndex: contacts.emailBlindIndex, orgId: campaigns.orgId })
    .from(contacts)
    .innerJoin(participants, eq(contacts.participantId, participants.id))
    .innerJoin(campaigns, eq(participants.campaignId, campaigns.id))
    .where(eq(contacts.id, recipientId))
    .limit(1);

  const [helper] = contact
    ? []
    : await db
        .select({ id: participantHelpers.id, unsubscribedAt: participantHelpers.unsubscribedAt, emailBlindIndex: participantHelpers.emailBlindIndex, orgId: campaigns.orgId })
        .from(participantHelpers)
        .innerJoin(participants, eq(participantHelpers.participantId, participants.id))
        .innerJoin(campaigns, eq(participants.campaignId, campaigns.id))
        .where(eq(participantHelpers.id, recipientId))
        .limit(1);

  const row = contact ?? helper;
  if (!row) return false;
  const targetType = contact ? "contact" : "helper";

  if (!row.unsubscribedAt) {
    if (contact) await db.update(contacts).set({ unsubscribedAt: new Date() }).where(eq(contacts.id, row.id));
    else await db.update(participantHelpers).set({ unsubscribedAt: new Date() }).where(eq(participantHelpers.id, row.id));
  }
  if (row.emailBlindIndex) {
    await db.insert(suppressions).values({ orgId: row.orgId, emailBlindIndex: row.emailBlindIndex, reason }).onConflictDoNothing();
  }
  await audit({ action: "suppression.add", targetType, targetId: row.id, orgId: row.orgId, ip: ip ?? null, metadata: { reason } });
  return true;
}
