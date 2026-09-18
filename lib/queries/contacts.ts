import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { contacts, suppressions } from "@/lib/db/schema";
import { decryptField, decryptOptional, CTX } from "@/lib/crypto";

export const RESEND_COOLDOWN_DAYS = 7;

/** What the owner's contacts UI renders. Plaintext: call only after ownership is proven. */
export type ContactRow = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  unsubscribed: boolean;
  lastInviteStatus: string | null;
  inviteCount: number;
  clickCount: number;
  smsTaps: number;
  /** Days since the last platform email, or null if never. */
  daysSinceInvite: number | null;
  /** Has an email, hasn't opted out or bounced, and is past the cooldown. */
  eligibleForEmail: boolean;
};

/** A participant's contacts with outreach state. Ciphertexts come back as-is; the owner's page decrypts. */
export async function listContactsForParticipant(participantId: string) {
  return db
    .select({
      contact: contacts,
      lastInviteStatus: sql<string | null>`(
        select e.status from email_invites e where e.contact_id = "contacts"."id" order by e.created_at desc limit 1
      )`,
      inviteCount: sql<number>`(
        select count(*) from email_invites e where e.contact_id = "contacts"."id" and e.status <> 'failed'
      )::int`,
      clickCount: sql<number>`(
        select coalesce(sum(s.click_count), 0) from share_links s where s.contact_id = "contacts"."id"
      )::int`,
      smsTaps: sql<number>`(
        select count(*) from outreach_events o where o.contact_id = "contacts"."id" and o.channel = 'sms'
      )::int`,
    })
    .from(contacts)
    .where(eq(contacts.participantId, participantId))
    .orderBy(desc(contacts.createdAt));
}

export async function countContacts(participantId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(contacts)
    .where(eq(contacts.participantId, participantId));
  return row?.n ?? 0;
}

/** Existing blind indexes, for de-duplicating an import without decrypting anything. */
export async function existingContactIndexes(participantId: string) {
  const rows = await db
    .select({ email: contacts.emailBlindIndex, phone: contacts.phoneBlindIndex })
    .from(contacts)
    .where(eq(contacts.participantId, participantId));
  return {
    emails: new Set(rows.map((r) => r.email).filter((x): x is string => Boolean(x))),
    phones: new Set(rows.map((r) => r.phone).filter((x): x is string => Boolean(x))),
  };
}

export async function isSuppressed(orgId: string, emailBlindIndex: string): Promise<boolean> {
  const [row] = await db
    .select({ id: suppressions.id })
    .from(suppressions)
    .where(and(eq(suppressions.orgId, orgId), eq(suppressions.emailBlindIndex, emailBlindIndex)))
    .limit(1);
  return Boolean(row);
}

/**
 * Decrypts the participant's own contacts and pre-computes everything time-
 * dependent, so the rendering component is pure. Authorization is the caller's
 * job — this must only run after requireParticipantOwner has passed.
 */
export async function loadContactRows(participantId: string, now: Date = new Date()): Promise<ContactRow[]> {
  const rows = await listContactsForParticipant(participantId);
  return rows.map((r) => {
    const email = decryptOptional(r.contact.emailCiphertext, CTX.contactEmail);
    const daysSinceInvite = r.contact.lastInvitedAt
      ? Math.floor((now.getTime() - r.contact.lastInvitedAt.getTime()) / 86_400_000)
      : null;
    const blocked = Boolean(r.contact.unsubscribedAt) || r.lastInviteStatus === "bounced" || r.lastInviteStatus === "complained";
    return {
      id: r.contact.id,
      name: decryptField(r.contact.nameCiphertext, CTX.contactName),
      email,
      phone: decryptOptional(r.contact.phoneCiphertext, CTX.contactPhone),
      unsubscribed: Boolean(r.contact.unsubscribedAt),
      lastInviteStatus: r.lastInviteStatus,
      inviteCount: r.inviteCount,
      clickCount: r.clickCount,
      smsTaps: r.smsTaps,
      daysSinceInvite,
      eligibleForEmail: Boolean(email) && !blocked && (daysSinceInvite === null || daysSinceInvite >= RESEND_COOLDOWN_DAYS),
    };
  });
}
