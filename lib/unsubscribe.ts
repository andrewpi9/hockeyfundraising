import { eq } from "drizzle-orm";
import { db } from "./db";
import { contacts, participants, campaigns, suppressions } from "./db/schema";
import { audit } from "./audit";

export type SuppressionReason = "unsubscribed" | "bounced" | "complained" | "manual";

/**
 * Marks the contact and adds the address to the ORG-WIDE suppression list, so a
 * person who opts out of one participant's emails is not mailed by another.
 * Idempotent. Never decrypts the address: the stored blind index is enough.
 */
export async function applyUnsubscribe(contactId: string, reason: SuppressionReason, ip?: string | null): Promise<boolean> {
  const [row] = await db
    .select({ contact: contacts, orgId: campaigns.orgId })
    .from(contacts)
    .innerJoin(participants, eq(contacts.participantId, participants.id))
    .innerJoin(campaigns, eq(participants.campaignId, campaigns.id))
    .where(eq(contacts.id, contactId))
    .limit(1);
  if (!row) return false;

  if (!row.contact.unsubscribedAt) {
    await db.update(contacts).set({ unsubscribedAt: new Date() }).where(eq(contacts.id, contactId));
  }
  if (row.contact.emailBlindIndex) {
    await db
      .insert(suppressions)
      .values({ orgId: row.orgId, emailBlindIndex: row.contact.emailBlindIndex, reason })
      .onConflictDoNothing();
  }
  await audit({
    action: "suppression.add",
    targetType: "contact",
    targetId: contactId,
    orgId: row.orgId,
    ip: ip ?? null,
    metadata: { reason },
  });
  return true;
}
