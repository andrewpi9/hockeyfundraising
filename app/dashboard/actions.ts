"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, eq, gt, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { put, del } from "@vercel/blob";
import { db } from "@/lib/db";
import { campaigns, participants, participantInvites } from "@/lib/db/schema";
import { requireUser, requireParticipantOwner } from "@/lib/authz";
import { limiters } from "@/lib/ratelimit";
import { runAction, type ActionState } from "@/lib/actions";
import { parseDollarsToCents } from "@/lib/money";
import { blindIndex } from "@/lib/crypto";
import { hashToken } from "@/lib/tokens";
import { createParticipantForUser } from "@/lib/participants";
import { sniffImageType, extensionFor, isOurBlobUrl, MAX_PHOTO_BYTES } from "@/lib/images";

// ---------------------------------------------------------------- joining

const JoinCode = z
  .string()
  .trim()
  .transform((s) => s.toUpperCase().replace(/[^A-Z0-9]/g, ""))
  .pipe(z.string().length(6, "Join codes are six characters"));

export async function joinCampaign(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const result = await runAction(async () => {
    const user = await requireUser();
    // Codes are 32^6 ≈ 1e9, but a limit costs nothing and makes guessing pointless.
    if (!(await limiters.mutation.limit(`join:${user.id}`)).success) return { ok: false, message: "Too many attempts. Try again in a minute." };

    const code = JoinCode.parse(formData.get("code"));
    const [campaign] = await db
      .select()
      .from(campaigns)
      .where(and(eq(campaigns.joinCode, code), inArray(campaigns.status, ["draft", "active"])))
      .limit(1);
    if (!campaign) return { ok: false, message: "That code didn't match an open campaign. Check it with your coach." };

    const participant = await createParticipantForUser(user, campaign);
    revalidatePath("/dashboard");
    revalidatePath(`/c/${campaign.slug}`);
    return { ok: true, message: "Joined.", id: participant.id };
  });
  if (result?.ok && result.id) redirect(`/dashboard/${result.id}`);
  return result;
}

export async function acceptInvite(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const result = await runAction(async () => {
    const user = await requireUser();
    if (!(await limiters.mutation.limit(`invite:${user.id}`)).success) return { ok: false, message: "Too many attempts. Try again in a minute." };

    const token = z.string().min(20).max(200).parse(formData.get("token"));
    const [invite] = await db
      .select()
      .from(participantInvites)
      .where(and(eq(participantInvites.tokenHash, hashToken(token)), isNull(participantInvites.acceptedAt), gt(participantInvites.expiresAt, new Date())))
      .limit(1);
    if (!invite) return { ok: false, message: "This invitation is invalid or has expired. Ask your coach to send a new one." };

    // The invite is bound to an address. A forwarded link does not transfer it.
    if (blindIndex("email", user.email) !== invite.emailBlindIndex) {
      return {
        ok: false,
        message: "This invitation was sent to a different email address. Sign in with that address, or ask your coach to re-send it to this one.",
      };
    }

    const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, invite.campaignId)).limit(1);
    if (!campaign || campaign.status === "closed") return { ok: false, message: "That campaign is no longer open." };

    const participant = await createParticipantForUser(user, campaign);
    await db
      .update(participantInvites)
      .set({ acceptedAt: new Date(), acceptedUserId: user.id })
      .where(eq(participantInvites.id, invite.id));

    revalidatePath("/dashboard");
    return { ok: true, message: "Welcome aboard.", id: participant.id };
  });
  if (result?.ok && result.id) redirect(`/dashboard/${result.id}`);
  return result;
}

// ---------------------------------------------------------------- profile

const Profile = z.object({
  participantId: z.string().uuid(),
  displayName: z.string().trim().min(2, "Name is too short").max(80),
  bio: z.string().trim().max(2000).optional(),
  goal: z.string().trim().max(20).optional(),
  teamRole: z.string().trim().max(40).optional(),
  classYear: z.string().trim().max(12).optional(),
});

export async function updateParticipantProfile(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const input = Profile.parse(Object.fromEntries(formData));
    // participantId is a hint; ownership is what authorizes.
    const { user, participant } = await requireParticipantOwner(input.participantId);
    if (!(await limiters.mutation.limit(user.id)).success) return { ok: false, message: "Slow down a little." };

    const goalCents = input.goal ? (parseDollarsToCents(input.goal) ?? -1) : 0;
    if (goalCents < 0) return { ok: false, message: "Goal must be a dollar amount." };

    await db
      .update(participants)
      .set({
        displayName: input.displayName,
        bio: input.bio || null,
        goalCents,
        teamRole: input.teamRole || null,
        classYear: input.classYear || null,
        updatedAt: new Date(),
      })
      .where(eq(participants.id, participant.id));

    const [campaign] = await db.select({ slug: campaigns.slug }).from(campaigns).where(eq(campaigns.id, participant.campaignId)).limit(1);
    revalidatePath(`/dashboard/${participant.id}`);
    if (campaign) {
      revalidatePath(`/c/${campaign.slug}`);
      revalidatePath(`/c/${campaign.slug}/${participant.slug}`);
    }
    return { ok: true, message: "Profile saved." };
  });
}

// ---------------------------------------------------------------- photo

function blobConfigured() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

export async function uploadPhoto(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const participantId = z.string().uuid().parse(formData.get("participantId"));
    const { user, participant } = await requireParticipantOwner(participantId);
    if (!(await limiters.mutation.limit(`photo:${user.id}`)).success) return { ok: false, message: "Too many uploads. Try again shortly." };
    if (!blobConfigured()) return { ok: false, message: "Photo uploads aren't configured on this server yet." };

    const file = formData.get("photo");
    if (!(file instanceof File) || file.size === 0) return { ok: false, message: "Choose a photo first." };
    if (file.size > MAX_PHOTO_BYTES) return { ok: false, message: "Photos must be under 2 MB." };

    // The declared MIME type is whatever the browser says. The bytes decide.
    const buffer = await file.arrayBuffer();
    const type = sniffImageType(new Uint8Array(buffer));
    if (!type) return { ok: false, message: "Please upload a JPEG, PNG or WebP image." };

    const path = `participants/${participant.id}/${crypto.randomUUID()}.${extensionFor[type]}`;
    const blob = await put(path, buffer, { access: "public", contentType: type, addRandomSuffix: false, cacheControlMaxAge: 60 * 60 * 24 * 365 });

    const previous = participant.photoUrl;
    await db.update(participants).set({ photoUrl: blob.url, updatedAt: new Date() }).where(eq(participants.id, participant.id));
    if (isOurBlobUrl(previous)) await del(previous!).catch(() => undefined);

    revalidatePath(`/dashboard/${participant.id}`);
    return { ok: true, message: "Photo updated." };
  });
}

export async function removePhoto(formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const participantId = z.string().uuid().parse(formData.get("participantId"));
    const { participant } = await requireParticipantOwner(participantId);
    if (isOurBlobUrl(participant.photoUrl) && blobConfigured()) await del(participant.photoUrl!).catch(() => undefined);
    await db.update(participants).set({ photoUrl: null, updatedAt: new Date() }).where(eq(participants.id, participant.id));
    revalidatePath(`/dashboard/${participant.id}`);
    return { ok: true, message: "Photo removed." };
  });
}

