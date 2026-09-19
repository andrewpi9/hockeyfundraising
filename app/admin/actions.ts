"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { and, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { campaigns, participants, participantInvites, users, organizations, donations } from "@/lib/db/schema";
import { requireAnyOrgAdmin, requireCampaignAdmin } from "@/lib/authz";
import { encryptField, blindIndex, normalizeEmail, CTX } from "@/lib/crypto";
import { joinCode } from "@/lib/ids";
import { inviteToken, hashToken, INVITE_TTL_MS } from "@/lib/tokens";
import { sendParticipantInvite, sendParticipantNudge } from "@/lib/email";
import { siteUrl } from "@/lib/site";
import { audit } from "@/lib/audit";
import { limiters } from "@/lib/ratelimit";
import { runAction, checkbox, dateInput, type ActionState } from "@/lib/actions";
import { parseDollarsToCents } from "@/lib/money";
import { uniqueCampaignSlug } from "@/lib/queries/campaigns";
import { listQuietParticipants } from "@/lib/queries/participants";


const CampaignInput = z.object({
  name: z.string().trim().min(2, "Name is too short").max(120),
  description: z.string().trim().max(5000).optional(),
  goal: z.string().trim().max(20).optional(),
  startsAt: z.string().optional(),
  endsAt: z.string().optional(),
  allowFeeCover: z.unknown().optional(),
});

function parseCampaign(formData: FormData) {
  const input = CampaignInput.parse(Object.fromEntries(formData));
  const goalCents = input.goal ? (parseDollarsToCents(input.goal) ?? -1) : 0;
  if (goalCents < 0) throw new z.ZodError([{ code: "custom", message: "Goal must be a dollar amount", path: ["goal"] }]);
  const startsAt = dateInput(input.startsAt) ?? new Date();
  const endsAt = dateInput(input.endsAt);
  if (endsAt && endsAt < startsAt) {
    throw new z.ZodError([{ code: "custom", message: "End date must be after the start date", path: ["endsAt"] }]);
  }
  return {
    name: input.name,
    description: input.description || null,
    goalCents,
    startsAt,
    endsAt,
    allowFeeCover: checkbox(input.allowFeeCover),
  };
}

export async function createCampaign(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const result = await runAction(async () => {
    const { user, org } = await requireAnyOrgAdmin();
    if (!(await limiters.mutation.limit(user.id)).success) return { ok: false, message: "Slow down a little." };

    const data = parseCampaign(formData);
    const slug = await uniqueCampaignSlug(org.id, data.name);

    const [created] = await db
      .insert(campaigns)
      .values({
        orgId: org.id,
        slug,
        ...data,
        status: "draft",
        platformFeeBps: org.platformFeeBps,
        joinCode: joinCode(),
        createdBy: user.id,
      })
      .returning({ id: campaigns.id });

    await audit({
      action: "campaign.create",
      targetType: "campaign",
      targetId: created!.id,
      orgId: org.id,
      actorUserId: user.id,
      metadata: { goal_cents: data.goalCents },
    });

    revalidatePath("/admin");
    return { ok: true, message: "Campaign created.", id: created!.id };
  });

  if (result?.ok && result.id) redirect(`/admin/campaigns/${result.id}`);
  return result;
}

export async function updateCampaign(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const campaignId = z.string().uuid().parse(formData.get("campaignId"));
    // The id is a lookup hint. Authority comes from the session user's membership
    // in the campaign's org, which requireCampaignAdmin resolves server-side.
    const { user, campaign } = await requireCampaignAdmin(campaignId);
    if (!(await limiters.mutation.limit(user.id)).success) return { ok: false, message: "Slow down a little." };

    const data = parseCampaign(formData);
    const changed = (Object.keys(data) as (keyof typeof data)[]).filter((k) => {
      const before = campaign[k];
      const after = data[k];
      return before instanceof Date || after instanceof Date
        ? (before as Date | null)?.getTime() !== (after as Date | null)?.getTime()
        : before !== after;
    });

    await db.update(campaigns).set({ ...data, updatedAt: new Date() }).where(eq(campaigns.id, campaign.id));

    await audit({
      action: "campaign.update",
      targetType: "campaign",
      targetId: campaign.id,
      orgId: campaign.orgId,
      actorUserId: user.id,
      // Field NAMES that changed, never their values.
      metadata: { fields: changed.join(","), field_count: changed.length },
    });

    revalidatePath("/admin");
    revalidatePath(`/admin/campaigns/${campaign.id}`);
    revalidatePath(`/c/${campaign.slug}`);
    return { ok: true, message: changed.length ? "Saved." : "No changes." };
  });
}

const Status = z.enum(["draft", "active", "closed"]);

export async function setCampaignStatus(formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const campaignId = z.string().uuid().parse(formData.get("campaignId"));
    const status = Status.parse(formData.get("status"));
    const { user, campaign } = await requireCampaignAdmin(campaignId);
    if (campaign.status === status) return { ok: true, message: "Already there." };

    await db.update(campaigns).set({ status, updatedAt: new Date() }).where(eq(campaigns.id, campaign.id));
    await audit({
      action: "campaign.status_change",
      targetType: "campaign",
      targetId: campaign.id,
      orgId: campaign.orgId,
      actorUserId: user.id,
      metadata: { from: campaign.status, to: status },
    });

    revalidatePath("/");
    revalidatePath("/admin");
    revalidatePath(`/admin/campaigns/${campaign.id}`);
    revalidatePath(`/c/${campaign.slug}`);
    return { ok: true, message: `Campaign is now ${status}.` };
  });
}

export async function rotateJoinCode(formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const campaignId = z.string().uuid().parse(formData.get("campaignId"));
    const { user, campaign } = await requireCampaignAdmin(campaignId);

    await db.update(campaigns).set({ joinCode: joinCode(), updatedAt: new Date() }).where(eq(campaigns.id, campaign.id));
    await audit({
      action: "campaign.update",
      targetType: "campaign",
      targetId: campaign.id,
      orgId: campaign.orgId,
      actorUserId: user.id,
      metadata: { fields: "join_code", field_count: 1 },
    });

    revalidatePath(`/admin/campaigns/${campaign.id}`);
    return { ok: true, message: "New join code issued. The old one no longer works." };
  });
}

// ---------------------------------------------------------------- roster (phase 2)

const InviteInput = z.object({
  campaignId: z.string().uuid(),
  email: z.email("Enter a valid email").max(200),
  /** When present, the invite claims this imported (placeholder) row instead of creating a new one. */
  participantId: z.union([z.string().uuid(), z.literal("")]).optional(),
});

export async function inviteParticipant(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const input = InviteInput.parse(Object.fromEntries(formData));
    const { user, campaign } = await requireCampaignAdmin(input.campaignId);
    if (!(await limiters.mutation.limit(user.id)).success) return { ok: false, message: "Slow down a little." };
    if (campaign.status === "closed") return { ok: false, message: "This campaign is closed." };

    const email = normalizeEmail(input.email);
    const emailIdx = blindIndex("email", email);

    let claimTarget: string | null = null;
    if (input.participantId) {
      const [target] = await db
        .select({ id: participants.id, isPlaceholder: users.isPlaceholder })
        .from(participants)
        .innerJoin(users, eq(participants.userId, users.id))
        .where(and(eq(participants.id, input.participantId), eq(participants.campaignId, campaign.id)))
        .limit(1);
      if (!target) return { ok: false, message: "That roster entry wasn't found in this campaign." };
      if (!target.isPlaceholder) return { ok: false, message: "That roster entry already has an account." };
      claimTarget = target.id;
    }

    // Already on the roster? Their users.email is plaintext identity, so this
    // lookup is exact without decrypting anything.
    const [already] = await db
      .select({ id: participants.id })
      .from(participants)
      .innerJoin(users, eq(participants.userId, users.id))
      .where(and(eq(participants.campaignId, campaign.id), eq(users.email, email), eq(participants.status, "active")))
      .limit(1);
    if (already) return { ok: false, message: "That person is already on the roster." };

    // Re-inviting supersedes any pending invite rather than stacking a second one.
    await db
      .delete(participantInvites)
      .where(and(eq(participantInvites.campaignId, campaign.id), eq(participantInvites.emailBlindIndex, emailIdx), isNull(participantInvites.acceptedAt)));

    const token = inviteToken();
    const [invite] = await db
      .insert(participantInvites)
      .values({
        campaignId: campaign.id,
        emailCiphertext: encryptField(email, CTX.inviteEmail),
        emailBlindIndex: emailIdx,
        participantId: claimTarget,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + INVITE_TTL_MS),
        invitedBy: user.id,
      })
      .returning({ id: participantInvites.id });

    const [org] = await db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, campaign.orgId)).limit(1);
    await sendParticipantInvite({
      to: email,
      campaignName: campaign.name,
      orgName: org?.name ?? "the organization",
      inviterName: user.name,
      url: siteUrl(`/join/${token}`),
    });

    await audit({
      action: "participant.invite",
      targetType: "participant_invite",
      targetId: invite!.id,
      orgId: campaign.orgId,
      actorUserId: user.id,
      metadata: { campaign_id: campaign.id, claims_participant: Boolean(claimTarget) },
    });

    revalidatePath(`/admin/campaigns/${campaign.id}`);
    return { ok: true, message: claimTarget ? "Invitation sent. Their existing page and totals will be waiting when they accept." : "Invitation sent." };
  });
}

export async function revokeInvite(formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const inviteId = z.string().uuid().parse(formData.get("inviteId"));
    const [invite] = await db.select().from(participantInvites).where(eq(participantInvites.id, inviteId)).limit(1);
    if (!invite) return { ok: false, message: "Invitation not found." };
    const { user, campaign } = await requireCampaignAdmin(invite.campaignId);

    await db.delete(participantInvites).where(eq(participantInvites.id, invite.id));
    await audit({
      action: "participant.invite_revoke",
      targetType: "participant_invite",
      targetId: invite.id,
      orgId: campaign.orgId,
      actorUserId: user.id,
    });
    revalidatePath(`/admin/campaigns/${campaign.id}`);
    return { ok: true, message: "Invitation revoked." };
  });
}

export async function removeParticipant(formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const participantId = z.string().uuid().parse(formData.get("participantId"));
    const [participant] = await db.select().from(participants).where(eq(participants.id, participantId)).limit(1);
    if (!participant) return { ok: false, message: "Participant not found." };
    const { user, campaign } = await requireCampaignAdmin(participant.campaignId);

    // Soft: donations stay attributed and the public page simply disappears.
    await db.update(participants).set({ status: "removed", updatedAt: new Date() }).where(eq(participants.id, participant.id));
    await audit({
      action: "participant.remove",
      targetType: "participant",
      targetId: participant.id,
      orgId: campaign.orgId,
      actorUserId: user.id,
    });
    revalidatePath(`/admin/campaigns/${campaign.id}`);
    revalidatePath(`/c/${campaign.slug}`);
    return { ok: true, message: "Participant removed." };
  });
}


// ---------------------------------------------------------------- organization settings (phase 3)

const OrgInput = z.object({
  name: z.string().trim().min(2).max(120),
  legalName: z.string().trim().max(160).optional(),
  ein: z.union([z.string().trim().regex(/^\d{2}-?\d{7}$/, "EIN looks like 12-3456789"), z.literal("")]).optional(),
  addressLine1: z.string().trim().max(160).optional(),
  addressLine2: z.string().trim().max(160).optional(),
  city: z.string().trim().max(80).optional(),
  state: z.string().trim().max(2).optional(),
  postalCode: z.string().trim().max(12).optional(),
});

export async function updateOrganization(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const { user, org } = await requireAnyOrgAdmin();
    if (!(await limiters.mutation.limit(user.id)).success) return { ok: false, message: "Slow down a little." };
    const input = OrgInput.parse(Object.fromEntries(formData));

    const next = {
      name: input.name,
      legalName: input.legalName || null,
      ein: input.ein || null,
      addressLine1: input.addressLine1 || null,
      addressLine2: input.addressLine2 || null,
      city: input.city || null,
      state: input.state?.toUpperCase() || null,
      postalCode: input.postalCode || null,
    };
    const changed = (Object.keys(next) as (keyof typeof next)[]).filter((k) => org[k] !== next[k]);

    await db.update(organizations).set({ ...next, updatedAt: new Date() }).where(eq(organizations.id, org.id));
    await audit({
      action: "org.update",
      targetType: "organization",
      targetId: org.id,
      orgId: org.id,
      actorUserId: user.id,
      metadata: { fields: changed.join(","), field_count: changed.length },
    });
    revalidatePath("/admin/settings");
    revalidatePath("/");
    return { ok: true, message: changed.length ? "Saved." : "No changes." };
  });
}

// ---------------------------------------------------------------- donations: reassign attribution

const ReassignInput = z.object({
  donationId: z.string().uuid(),
  /** Empty string credits the gift to the team as a whole. */
  participantId: z.union([z.string().uuid(), z.literal("")]),
});

/**
 * Moves a gift's credit to a different player (or to the team). Money is
 * untouched — this only changes which page and leaderboard row it counts
 * toward. The share link that produced it no longer applies, so it is cleared.
 */
export async function reassignDonation(formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const input = ReassignInput.parse(Object.fromEntries(formData));
    const [donation] = await db.select().from(donations).where(eq(donations.id, input.donationId)).limit(1);
    if (!donation) return { ok: false, message: "Donation not found." };
    const { user, campaign } = await requireCampaignAdmin(donation.campaignId);

    let target: string | null = null;
    if (input.participantId) {
      const [p] = await db
        .select({ id: participants.id })
        .from(participants)
        .where(and(eq(participants.id, input.participantId), eq(participants.campaignId, campaign.id)))
        .limit(1);
      if (!p) return { ok: false, message: "That player isn't in this campaign." };
      target = p.id;
    }
    if (target === donation.participantId) return { ok: true, message: "No change." };

    await db.update(donations).set({ participantId: target, shareLinkId: null, updatedAt: new Date() }).where(eq(donations.id, donation.id));
    await audit({
      action: "donation.reassign",
      targetType: "donation",
      targetId: donation.id,
      orgId: campaign.orgId,
      actorUserId: user.id,
      metadata: { from_participant: donation.participantId, to_participant: target },
    });

    revalidatePath(`/admin/campaigns/${campaign.id}`);
    revalidatePath(`/c/${campaign.slug}`);
    return { ok: true, message: target ? "Reassigned." : "Credited to the team." };
  });
}

// ---------------------------------------------------------------- participants: nudge the quiet ones

export async function nudgeQuietParticipants(formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const campaignId = z.string().uuid().parse(formData.get("campaignId"));
    const { user, campaign } = await requireCampaignAdmin(campaignId);
    // One nudge round per campaign per day. Reminders lose their force fast.
    if (!(await limiters.export.limit(`nudge:${campaign.id}`)).success) return { ok: false, message: "Already nudged recently. Try again tomorrow." };
    if (campaign.status !== "active") return { ok: false, message: "The campaign isn't active." };

    const quiet = await listQuietParticipants(campaign.id);
    let sent = 0;
    for (const q of quiet) {
      try {
        await sendParticipantNudge({
          to: q.email,
          firstName: (q.displayName.split(" ")[0] ?? q.displayName),
          campaignName: campaign.name,
          coachName: user.name,
          consoleUrl: siteUrl(`/dashboard/${q.participantId}`),
        });
        sent += 1;
      } catch (err) {
        console.error("[nudge] send failed:", err instanceof Error ? err.message : "unknown");
      }
    }

    await audit({ action: "participant.nudge", targetType: "campaign", targetId: campaign.id, orgId: campaign.orgId, actorUserId: user.id, metadata: { quiet_count: quiet.length, sent } });
    revalidatePath(`/admin/campaigns/${campaign.id}`);
    return { ok: true, message: quiet.length === 0 ? "Everyone has shared at least once." : `Nudged ${sent} of ${quiet.length}.` };
  });
}
