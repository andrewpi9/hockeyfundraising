"use server";

import { revalidatePath } from "next/cache";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { participants, contacts, shareLinks, outreach } from "@/lib/db/schema";
import { requireSession } from "@/lib/auth";
import { getActiveCampaign } from "@/lib/queries";
import { shareCode } from "@/lib/ids";
import { parseDollarsToCents } from "@/lib/money";

export type ActionState = { ok: boolean; message: string } | null;

/** Every action funnels through this, so a player can only ever touch their own row. */
async function requireOwnParticipant() {
  const session = await requireSession();
  const campaign = await getActiveCampaign();
  if (!campaign) throw new Error("No active campaign.");

  const [participant] = await db
    .select()
    .from(participants)
    .where(
      and(
        eq(participants.userId, session.userId),
        eq(participants.campaignId, campaign.id),
      ),
    )
    .limit(1);

  if (!participant) throw new Error("You are not on the roster for this campaign.");
  return { session, campaign, participant };
}

/** Confirms a contact belongs to the signed-in player before acting on it. */
async function requireOwnContact(contactId: string) {
  const { participant } = await requireOwnParticipant();
  const [contact] = await db
    .select()
    .from(contacts)
    .where(and(eq(contacts.id, contactId), eq(contacts.participantId, participant.id)))
    .limit(1);
  if (!contact) throw new Error("Contact not found.");
  return { participant, contact };
}

export async function getOrCreateLink(
  participantId: string,
  contactId: string | null,
  channel: "sms" | "email" | "social" | "direct",
): Promise<string> {
  const where = contactId
    ? and(eq(shareLinks.contactId, contactId), eq(shareLinks.channel, channel))
    : and(
        eq(shareLinks.participantId, participantId),
        isNull(shareLinks.contactId),
        eq(shareLinks.channel, channel),
      );

  const [existing] = await db.select().from(shareLinks).where(where).limit(1);
  if (existing) return existing.code;

  const [created] = await db
    .insert(shareLinks)
    .values({ code: shareCode(), participantId, contactId, channel })
    .returning();
  return created!.code;
}

const ProfileSchema = z.object({
  displayName: z.string().trim().min(2).max(80),
  bio: z.string().trim().max(2000).optional(),
  photoUrl: z.union([z.url(), z.literal("")]).optional(),
  goal: z.string().optional(),
  jerseyNumber: z.string().trim().max(4).optional(),
  position: z.string().trim().max(32).optional(),
  gradYear: z.string().trim().max(8).optional(),
});

export async function updateProfile(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const { participant } = await requireOwnParticipant();
    const parsed = ProfileSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) {
      return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid input." };
    }
    const input = parsed.data;

    await db
      .update(participants)
      .set({
        displayName: input.displayName,
        bio: input.bio || null,
        photoUrl: input.photoUrl || null,
        goalCents: input.goal ? (parseDollarsToCents(input.goal) ?? 0) : 0,
        jerseyNumber: input.jerseyNumber || null,
        position: input.position || null,
        gradYear: input.gradYear || null,
      })
      .where(eq(participants.id, participant.id));

    revalidatePath("/me");
    revalidatePath(`/p/${participant.slug}`);
    revalidatePath("/");
    return { ok: true, message: "Profile saved." };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Failed." };
  }
}

const ContactSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    email: z.union([z.email(), z.literal("")]).optional(),
    phone: z.string().trim().max(32).optional(),
    note: z.string().trim().max(200).optional(),
  })
  .refine((v) => Boolean(v.email) || Boolean(v.phone), {
    message: "Add an email or a phone number so you can reach them.",
  });

export async function addContact(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const { participant } = await requireOwnParticipant();
    const parsed = ContactSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) {
      return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid input." };
    }
    const input = parsed.data;

    const [contact] = await db
      .insert(contacts)
      .values({
        participantId: participant.id,
        name: input.name,
        email: input.email || null,
        phone: input.phone?.replace(/[^\d+]/g, "") || null,
        note: input.note || null,
      })
      .returning();

    // Mint the tracked link now so the share buttons are usable immediately.
    if (contact) await getOrCreateLink(participant.id, contact.id, "direct");

    revalidatePath("/me");
    return { ok: true, message: `${input.name} added.` };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Failed." };
  }
}

export async function deleteContact(formData: FormData): Promise<void> {
  const contactId = String(formData.get("contactId") ?? "");
  const { contact } = await requireOwnContact(contactId);
  await db.delete(contacts).where(eq(contacts.id, contact.id));
  revalidatePath("/me");
}

/** Called when the player actually opens a prefilled text or email. */
export async function recordOutreach(
  contactId: string,
  channel: "sms" | "email",
): Promise<void> {
  const { contact } = await requireOwnContact(contactId);
  await db.insert(outreach).values({ contactId: contact.id, channel });
  await db
    .update(contacts)
    .set({ lastContactedAt: new Date() })
    .where(eq(contacts.id, contact.id));
  revalidatePath("/me");
}

const BulkSchema = z.object({ pasted: z.string().max(20_000) });

/**
 * Accepts a pasted block of "Name, email, phone" lines — what you get from an
 * exported contacts app or a copied spreadsheet column. Deliberately lenient:
 * the goal is that a player can get 30 contacts in without fighting a form.
 */
export async function importContacts(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const { participant } = await requireOwnParticipant();
    const parsed = BulkSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return { ok: false, message: "Nothing to import." };

    const rows = parsed.data.pasted
      .split(/\r?\n/)
      .map((line) => line.split(/[,\t]/).map((c) => c.trim()))
      .filter((cells) => cells.some(Boolean));

    let added = 0;
    for (const cells of rows) {
      const name = cells[0];
      if (!name) continue;
      const email = cells.find((c) => c.includes("@")) ?? null;
      const phoneRaw = cells.find((c) => /\d{7,}/.test(c.replace(/\D/g, "")));
      const phone = phoneRaw ? phoneRaw.replace(/[^\d+]/g, "") : null;
      if (!email && !phone) continue;

      const [contact] = await db
        .insert(contacts)
        .values({ participantId: participant.id, name, email, phone })
        .returning();
      if (contact) await getOrCreateLink(participant.id, contact.id, "direct");
      added += 1;
    }

    revalidatePath("/me");
    return {
      ok: added > 0,
      message: added > 0 ? `Imported ${added} contacts.` : "No usable rows found.",
    };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Failed." };
  }
}
