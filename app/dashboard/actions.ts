"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { users, participants, campaigns } from "@/lib/db/schema";
import { requireAdmin } from "@/lib/auth";
import { getActiveCampaign } from "@/lib/queries";
import { slugify } from "@/lib/ids";
import { parseDollarsToCents } from "@/lib/money";

export type ActionState = { ok: boolean; message: string } | null;

const PlayerSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.email().max(200),
  goal: z.string().optional(),
});

/**
 * Adding a player here is what lets them sign in — the login route only issues
 * links to emails that already exist, so the roster is the access list.
 */
export async function addPlayer(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    await requireAdmin();
    const campaign = await getActiveCampaign();
    if (!campaign) return { ok: false, message: "No active campaign." };

    const parsed = PlayerSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) {
      return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid input." };
    }
    const { name, email, goal } = parsed.data;
    const normalized = email.trim().toLowerCase();

    let [user] = await db
      .select()
      .from(users)
      .where(eq(users.email, normalized))
      .limit(1);

    if (!user) {
      [user] = await db
        .insert(users)
        .values({ email: normalized, name, role: "player" })
        .returning();
    }
    if (!user) return { ok: false, message: "Could not create that player." };

    const existing = await db
      .select({ id: participants.id })
      .from(participants)
      .where(
        and(
          eq(participants.campaignId, campaign.id),
          eq(participants.userId, user.id),
        ),
      )
      .limit(1);

    if (existing.length > 0) {
      return { ok: false, message: `${name} is already on this roster.` };
    }

    // Slugs must be unique per campaign; suffix on collision rather than fail,
    // because two players named Chris Miller is a real thing.
    const base = slugify(name) || "player";
    let slug = base;
    for (let i = 2; i < 50; i += 1) {
      const clash = await db
        .select({ id: participants.id })
        .from(participants)
        .where(
          and(eq(participants.campaignId, campaign.id), eq(participants.slug, slug)),
        )
        .limit(1);
      if (clash.length === 0) break;
      slug = `${base}-${i}`;
    }

    await db.insert(participants).values({
      campaignId: campaign.id,
      userId: user.id,
      slug,
      displayName: name,
      goalCents: goal ? (parseDollarsToCents(goal) ?? 0) : 0,
    });

    revalidatePath("/dashboard");
    revalidatePath("/");
    return { ok: true, message: `${name} added. They can now sign in with ${normalized}.` };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Failed." };
  }
}

const CampaignSchema = z.object({
  name: z.string().trim().min(2).max(120),
  tagline: z.string().trim().max(160).optional(),
  story: z.string().trim().max(5000).optional(),
  goal: z.string().optional(),
  endsAt: z.string().optional(),
});

export async function updateCampaign(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    await requireAdmin();
    const campaign = await getActiveCampaign();
    if (!campaign) return { ok: false, message: "No active campaign." };

    const parsed = CampaignSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) {
      return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid input." };
    }
    const input = parsed.data;

    await db
      .update(campaigns)
      .set({
        name: input.name,
        tagline: input.tagline || null,
        story: input.story || null,
        goalCents: input.goal ? (parseDollarsToCents(input.goal) ?? 0) : 0,
        endsAt: input.endsAt ? new Date(input.endsAt) : null,
      })
      .where(eq(campaigns.id, campaign.id));

    revalidatePath("/dashboard");
    revalidatePath("/");
    return { ok: true, message: "Campaign updated." };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Failed." };
  }
}
