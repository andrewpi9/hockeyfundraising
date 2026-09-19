/**
 * Family helpers: a parent or relative the player asks to spread their page.
 * Everything a helper can receive is gated here, so the action layer cannot
 * skip a check: the helper cap, org-wide suppression, and a daily resend limit.
 */
import { and, eq, sql } from "drizzle-orm";
import { db } from "./db";
import { participantHelpers, shareLinks, donations, type Campaign, type Organization, type Participant, type ParticipantHelper } from "./db/schema";
import { encryptField, decryptField, blindIndex, normalizeEmail, signUnsubscribeToken, CTX } from "./crypto";
import { isSuppressed } from "./queries/contacts";
import { shareCode } from "./ids";
import { sendHelperKit } from "./email";
import { orgPostalAddress } from "./outreach";
import { audit } from "./audit";
import { siteUrl } from "./site";

export const HELPER_CAP = 4;
export const KIT_RESEND_COOLDOWN_MS = 24 * 3_600_000;

export class HelperError extends Error {}

type Ctx = { participant: Participant; campaign: Campaign; org: Organization };

export async function createHelper(ctx: Ctx, input: { name: string; email: string; relationship: string | null }): Promise<{ helper: ParticipantHelper; kitSent: boolean }> {
  const email = normalizeEmail(input.email);
  const idx = blindIndex("email", email);

  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(participantHelpers).where(eq(participantHelpers.participantId, ctx.participant.id));
  if (n >= HELPER_CAP) throw new HelperError(`You can add up to ${HELPER_CAP} helpers.`);

  const [dup] = await db
    .select({ id: participantHelpers.id })
    .from(participantHelpers)
    .where(and(eq(participantHelpers.participantId, ctx.participant.id), eq(participantHelpers.emailBlindIndex, idx)))
    .limit(1);
  if (dup) throw new HelperError("That person is already one of your helpers.");

  if (await isSuppressed(ctx.org.id, idx)) {
    throw new HelperError("That address has opted out of email from this organization, so we can't send them the kit. Share your link with them directly.");
  }

  // Their own link, so what comes through them is credited as such.
  const [link] = await db
    .insert(shareLinks)
    .values({ code: shareCode(), participantId: ctx.participant.id, campaignId: ctx.campaign.id, medium: "family" })
    .returning();

  const [helper] = await db
    .insert(participantHelpers)
    .values({
      participantId: ctx.participant.id,
      nameCiphertext: encryptField(input.name.trim(), CTX.helperName),
      emailCiphertext: encryptField(email, CTX.helperEmail),
      emailBlindIndex: idx,
      relationship: input.relationship?.trim() || null,
      shareLinkId: link!.id,
    })
    .returning();

  await audit({ action: "helper.add", targetType: "helper", targetId: helper!.id, orgId: ctx.org.id, metadata: { participant_id: ctx.participant.id } });

  let kitSent = false;
  try {
    await sendKit(ctx, helper!);
    kitSent = true;
  } catch (err) {
    console.error("[helper] kit send failed:", err instanceof Error ? err.message : "unknown");
  }
  return { helper: helper!, kitSent };
}

/** Sends (or re-sends) the share kit. Throws HelperError inside the cooldown. */
export async function sendKit(ctx: Ctx, helper: ParticipantHelper): Promise<void> {
  if (helper.unsubscribedAt) throw new HelperError("They've unsubscribed.");
  if (helper.kitSentAt && Date.now() - helper.kitSentAt.getTime() < KIT_RESEND_COOLDOWN_MS) {
    throw new HelperError("The kit was sent in the last 24 hours. Give it a day.");
  }
  if (await isSuppressed(ctx.org.id, helper.emailBlindIndex)) throw new HelperError("That address has opted out of email from this organization.");

  const [link] = helper.shareLinkId ? await db.select().from(shareLinks).where(eq(shareLinks.id, helper.shareLinkId)).limit(1) : [];
  const code = link?.code;
  const pageUrl = code ? siteUrl(`/r/${code}`) : siteUrl(`/c/${ctx.campaign.slug}/${ctx.participant.slug}`);
  const token = signUnsubscribeToken(helper.id);

  await sendHelperKit({
    to: decryptField(helper.emailCiphertext, CTX.helperEmail),
    helperFirstName: decryptField(helper.nameCiphertext, CTX.helperName).split(" ")[0] ?? "there",
    playerName: ctx.participant.displayName,
    campaignName: ctx.campaign.name,
    orgName: ctx.org.name,
    orgAddress: orgPostalAddress(ctx.org),
    pageUrl,
    qrUrl: code ? siteUrl(`/qr/${code}`) : pageUrl,
    unsubscribeUrl: siteUrl(`/unsubscribe/${token}`),
    oneClickUrl: siteUrl(`/api/unsubscribe/${token}`),
  });

  await db
    .update(participantHelpers)
    .set({ kitSentAt: new Date(), kitSendCount: sql`${participantHelpers.kitSendCount} + 1` })
    .where(eq(participantHelpers.id, helper.id));
  await audit({ action: "helper.kit_sent", targetType: "helper", targetId: helper.id, orgId: ctx.org.id, metadata: { participant_id: ctx.participant.id, resend: helper.kitSendCount > 0 } });
}

export type HelperRow = {
  id: string;
  name: string;
  email: string;
  relationship: string | null;
  kitSentAt: Date | null;
  kitSendCount: number;
  unsubscribed: boolean;
  clicks: number;
  gifts: number;
  raisedCents: number;
  canResend: boolean;
};

/** The player's own helpers, decrypted for the player. Call only after ownership is proven. */
export async function listHelpers(participantId: string, now: Date = new Date()): Promise<HelperRow[]> {
  const rows = await db
    .select({
      helper: participantHelpers,
      clicks: sql<number>`coalesce(${shareLinks.clickCount}, 0)::int`,
      gifts: sql<number>`(select count(*) from ${donations} d where d.share_link_id = ${participantHelpers.shareLinkId} and d.status = 'succeeded')::int`,
      raisedCents: sql<number>`(select coalesce(sum(d.designated_amount_cents), 0) from ${donations} d where d.share_link_id = ${participantHelpers.shareLinkId} and d.status = 'succeeded')::int`,
    })
    .from(participantHelpers)
    .leftJoin(shareLinks, eq(participantHelpers.shareLinkId, shareLinks.id))
    .where(eq(participantHelpers.participantId, participantId))
    .orderBy(participantHelpers.createdAt);

  return rows.map((r) => ({
    id: r.helper.id,
    name: decryptField(r.helper.nameCiphertext, CTX.helperName),
    email: decryptField(r.helper.emailCiphertext, CTX.helperEmail),
    relationship: r.helper.relationship,
    kitSentAt: r.helper.kitSentAt,
    kitSendCount: r.helper.kitSendCount,
    unsubscribed: Boolean(r.helper.unsubscribedAt),
    clicks: r.clicks,
    gifts: r.gifts,
    raisedCents: r.raisedCents,
    canResend: !r.helper.unsubscribedAt && (!r.helper.kitSentAt || now.getTime() - r.helper.kitSentAt.getTime() >= KIT_RESEND_COOLDOWN_MS),
  }));
}
