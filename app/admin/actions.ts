"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { customAlphabet } from "nanoid";
import { db } from "@/lib/db";
import { campaigns } from "@/lib/db/schema";
import { requireAnyOrgAdmin, requireCampaignAdmin } from "@/lib/authz";
import { audit } from "@/lib/audit";
import { limiters } from "@/lib/ratelimit";
import { runAction, checkbox, dateInput, type ActionState } from "@/lib/actions";
import { parseDollarsToCents } from "@/lib/money";
import { uniqueCampaignSlug } from "@/lib/queries/campaigns";

// Uppercase, no I/O/0/1: a join code gets read off a whiteboard.
const joinCode = customAlphabet("ABCDEFGHJKLMNPQRSTUVWXYZ23456789", 6);

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
