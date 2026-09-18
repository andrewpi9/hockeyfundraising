import { and, eq, inArray } from "drizzle-orm";
import { db } from "./db";
import { contacts, emailInvites, type Campaign, type Organization, type Participant } from "./db/schema";
import { decryptOptional, signUnsubscribeToken, CTX } from "./crypto";
import { ensureContactShareLink } from "./sharing";
import { isSuppressed } from "./queries/contacts";
import { sendOutreachInvite } from "./email";
import { siteUrl } from "./site";

/** Abuse controls. All three were agreed with the org before build. */
export const CONTACT_CAP = 100;
export const OUTREACH_BATCH_MAX = 25;
export const RESEND_COOLDOWN_MS = 7 * 86_400_000;

export function orgPostalAddress(org: Organization): string | null {
  const parts = [org.addressLine1, org.addressLine2, [org.city, org.state].filter(Boolean).join(", "), org.postalCode].filter(Boolean);
  return org.addressLine1 && org.city && org.state && org.postalCode ? parts.join(", ") : null;
}

export type SendSummary = {
  sent: number;
  skipped: { noEmail: number; unsubscribed: number; suppressed: number; recent: number; notOwned: number };
};

/**
 * The only path that sends email to an imported contact. Every gate is here so
 * the action layer cannot forget one:
 *   - the contact belongs to this participant
 *   - it has an email and has not unsubscribed
 *   - the address is not on the org-wide suppression list
 *   - it was not mailed in the last 7 days
 */
export async function sendInvitesForContacts(ctx: {
  participant: Participant;
  campaign: Campaign;
  org: Organization;
  contactIds: string[];
  note: string | null;
}): Promise<SendSummary> {
  const address = orgPostalAddress(ctx.org);
  if (!address) {
    throw new Error("The organization's mailing address must be on file before email can be sent. An admin can add it under Settings.");
  }

  const ids = [...new Set(ctx.contactIds)].slice(0, OUTREACH_BATCH_MAX);
  const summary: SendSummary = { sent: 0, skipped: { noEmail: 0, unsubscribed: 0, suppressed: 0, recent: 0, notOwned: 0 } };
  if (ids.length === 0) return summary;

  const rows = await db
    .select()
    .from(contacts)
    .where(and(inArray(contacts.id, ids), eq(contacts.participantId, ctx.participant.id)));
  summary.skipped.notOwned = ids.length - rows.length;

  for (const contact of rows) {
    const email = decryptOptional(contact.emailCiphertext, CTX.contactEmail);
    if (!email || !contact.emailBlindIndex) {
      summary.skipped.noEmail += 1;
      continue;
    }
    if (contact.unsubscribedAt) {
      summary.skipped.unsubscribed += 1;
      continue;
    }
    if (await isSuppressed(ctx.org.id, contact.emailBlindIndex)) {
      summary.skipped.suppressed += 1;
      continue;
    }
    if (contact.lastInvitedAt && Date.now() - contact.lastInvitedAt.getTime() < RESEND_COOLDOWN_MS) {
      summary.skipped.recent += 1;
      continue;
    }

    const code = await ensureContactShareLink(ctx.participant.id, ctx.campaign.id, contact.id, "email_invite");
    const token = signUnsubscribeToken(contact.id);

    let providerId: string | null = null;
    let status: "sent" | "failed" = "sent";
    try {
      providerId = await sendOutreachInvite({
        to: email,
        participantName: ctx.participant.displayName,
        campaignName: ctx.campaign.name,
        orgName: ctx.org.name,
        orgAddress: address,
        note: ctx.note,
        url: siteUrl(`/r/${code}`),
        unsubscribeUrl: siteUrl(`/unsubscribe/${token}`),
        oneClickUrl: siteUrl(`/api/unsubscribe/${token}`),
      });
    } catch (err) {
      status = "failed";
      console.error("[outreach] send failed:", err instanceof Error ? err.message : "unknown");
    }

    await db.insert(emailInvites).values({
      contactId: contact.id,
      participantId: ctx.participant.id,
      providerMessageId: providerId,
      status,
      sentAt: status === "sent" ? new Date() : null,
    });
    if (status === "sent") {
      await db.update(contacts).set({ lastInvitedAt: new Date() }).where(eq(contacts.id, contact.id));
      summary.sent += 1;
    }
  }

  return summary;
}

export function describeSummary(s: SendSummary): string {
  const parts = [`Sent ${s.sent}.`];
  const sk = s.skipped;
  const skipped: string[] = [];
  if (sk.recent) skipped.push(`${sk.recent} emailed in the last 7 days`);
  if (sk.unsubscribed) skipped.push(`${sk.unsubscribed} unsubscribed`);
  if (sk.suppressed) skipped.push(`${sk.suppressed} opted out org-wide`);
  if (sk.noEmail) skipped.push(`${sk.noEmail} without an email`);
  if (skipped.length) parts.push(`Skipped ${skipped.join(", ")}.`);
  return parts.join(" ");
}
