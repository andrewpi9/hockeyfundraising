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
import { createParticipantForUser, claimParticipantForUser } from "@/lib/participants";
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

    const participant = invite.participantId
      ? await claimParticipantForUser(user, invite.participantId)
      : await createParticipantForUser(user, campaign);
    await db
      .update(participantInvites)
      .set({ acceptedAt: new Date(), acceptedUserId: user.id })
      .where(eq(participantInvites.id, invite.id));

    revalidatePath("/dashboard");
    revalidatePath(`/c/${campaign.slug}`);
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
  rosterNumber: z.string().trim().max(4).optional(),
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
        rosterNumber: input.rosterNumber || null,
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


// ---------------------------------------------------------------- contacts (phase 3)

import { contacts, contactImports, outreachEvents, organizations, participantHelpers } from "@/lib/db/schema";
import { createHelper, sendKit, HelperError } from "@/lib/helpers";
import { encryptField, encryptOptional, decryptOptional, CTX } from "@/lib/crypto";
import { parseContactsCsv, MAX_CSV_BYTES, type ParsedContact } from "@/lib/csv";
import { countContacts, existingContactIndexes } from "@/lib/queries/contacts";
import { ensureContactShareLink } from "@/lib/sharing";
import { sendInvitesForContacts, describeSummary, CONTACT_CAP, OUTREACH_BATCH_MAX } from "@/lib/outreach";
import { siteUrl } from "@/lib/site";
import { checkbox } from "@/lib/actions";

/** Encrypts and inserts, skipping anything already present for this participant. Returns how many landed. */
async function insertContacts(participantId: string, parsed: ParsedContact[], source: "csv" | "manual") {
  const existing = await existingContactIndexes(participantId);
  const room = Math.max(0, CONTACT_CAP - (await countContacts(participantId)));
  let inserted = 0;
  let duplicates = 0;

  for (const c of parsed) {
    if (inserted >= room) break;
    const emailIdx = c.email ? blindIndex("email", c.email) : null;
    const phoneIdx = c.phone ? blindIndex("phone", c.phone) : null;
    if ((emailIdx && existing.emails.has(emailIdx)) || (phoneIdx && existing.phones.has(phoneIdx))) {
      duplicates += 1;
      continue;
    }
    await db.insert(contacts).values({
      participantId,
      nameCiphertext: encryptField(c.name, CTX.contactName),
      emailCiphertext: encryptOptional(c.email, CTX.contactEmail),
      phoneCiphertext: encryptOptional(c.phone, CTX.contactPhone),
      emailBlindIndex: emailIdx,
      phoneBlindIndex: phoneIdx,
      source,
    });
    if (emailIdx) existing.emails.add(emailIdx);
    if (phoneIdx) existing.phones.add(phoneIdx);
    inserted += 1;
  }
  return { inserted, duplicates, overCap: Math.max(0, parsed.length - duplicates - inserted) };
}

export async function importContacts(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const participantId = z.string().uuid().parse(formData.get("participantId"));
    const { participant } = await requireParticipantOwner(participantId);
    if (!(await limiters.contactImport.limit(participant.id)).success) return { ok: false, message: "Too many imports this hour. Try again later." };

    // The attestation is recorded, not just required. It is the participant's
    // statement that these are people who know them, not a purchased list.
    if (!checkbox(formData.get("attest"))) return { ok: false, message: "Please confirm these are your own contacts." };

    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) return { ok: false, message: "Choose a CSV file first." };
    if (file.size > MAX_CSV_BYTES) return { ok: false, message: "That file is over 1 MB. Export just your contacts, not a whole workbook." };

    const result = parseContactsCsv(await file.text());
    const { inserted, duplicates, overCap } = await insertContacts(participant.id, result.contacts, "csv");

    await db.insert(contactImports).values({
      participantId: participant.id,
      originalFilename: (file.name || "upload.csv").slice(0, 200),
      byteSize: file.size,
      rowCount: result.rowCount,
      importedCount: inserted,
      skippedCount: result.skipped + duplicates + overCap,
      attestedConsent: true,
      errorSummary: result.errors.join(" ") || null,
    });
    revalidatePath(`/dashboard/${participant.id}`);
    const notes: string[] = [];
    if (duplicates) notes.push(`${duplicates} already on your list`);
    if (result.skipped) notes.push(`${result.skipped} rows had no usable name, email or phone`);
    if (overCap) notes.push(`${overCap} not added — the list holds ${CONTACT_CAP}`);
    return { ok: inserted > 0 || notes.length === 0, message: `Added ${inserted} contact${inserted === 1 ? "" : "s"}.${notes.length ? ` (${notes.join("; ")}.)` : ""}` };
  });
}

const ManualContact = z
  .object({
    participantId: z.string().uuid(),
    name: z.string().trim().min(1, "Name is required").max(120),
    email: z.union([z.email("That email doesn't look right"), z.literal("")]).optional(),
    phone: z.string().trim().max(32).optional(),
  })
  .refine((v) => Boolean(v.email) || Boolean(v.phone?.replace(/\D/g, "").length), { message: "Add an email or a phone number." });

export async function addContact(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const input = ManualContact.parse(Object.fromEntries(formData));
    const { participant } = await requireParticipantOwner(input.participantId);
    if (!(await limiters.mutation.limit(participant.id)).success) return { ok: false, message: "Slow down a little." };

    const parsed = parseContactsCsv(`name,email,phone\n"${input.name.replace(/"/g, '""')}",${input.email ?? ""},${input.phone ?? ""}`);
    if (parsed.contacts.length === 0) return { ok: false, message: "Add a valid email or a 10-digit phone number." };

    const { inserted, duplicates, overCap } = await insertContacts(participant.id, parsed.contacts, "manual");
    revalidatePath(`/dashboard/${participant.id}`);
    if (duplicates) return { ok: false, message: "That person is already on your list." };
    if (overCap) return { ok: false, message: `Your list is full (${CONTACT_CAP}). Remove someone to add another.` };
    return { ok: inserted === 1, message: inserted === 1 ? `${input.name} added.` : "Could not add that contact." };
  });
}

export async function deleteContact(formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const contactId = z.string().uuid().parse(formData.get("contactId"));
    const participantId = z.string().uuid().parse(formData.get("participantId"));
    const { participant } = await requireParticipantOwner(participantId);
    // Scoped delete: the WHERE carries the owner, so a foreign contact id is a no-op.
    await db.delete(contacts).where(and(eq(contacts.id, contactId), eq(contacts.participantId, participant.id)));
    revalidatePath(`/dashboard/${participant.id}`);
    return { ok: true, message: "Removed." };
  });
}

export async function sendInvites(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const participantId = z.string().uuid().parse(formData.get("participantId"));
    const contactIds = z.array(z.string().uuid()).min(1, "Select at least one contact").max(OUTREACH_BATCH_MAX, `Send to at most ${OUTREACH_BATCH_MAX} at a time`).parse(formData.getAll("contactIds"));
    const note = z.string().trim().max(300, "Keep the note under 300 characters").optional().parse(formData.get("note") ?? undefined) || null;

    const { participant } = await requireParticipantOwner(participantId);
    // The whole batch is charged against the daily allowance up front.
    if (!(await limiters.emailInvite.limit(participant.id, contactIds.length)).success) {
      return { ok: false, message: "You've hit today's sending limit. It resets in 24 hours." };
    }

    const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, participant.campaignId)).limit(1);
    if (!campaign || campaign.status !== "active") return { ok: false, message: "Invites can only go out while the campaign is active." };
    const [org] = await db.select().from(organizations).where(eq(organizations.id, campaign.orgId)).limit(1);
    if (!org) return { ok: false, message: "Organization not found." };

    const summary = await sendInvitesForContacts({ participant, campaign, org, contactIds, note });
    revalidatePath(`/dashboard/${participant.id}`);
    return { ok: summary.sent > 0, message: describeSummary(summary) };
  });
}

export type SmsPrep = { ok: true; href: string } | { ok: false; message: string };

/**
 * Mints the contact's tracked link, records the tap, and returns an sms: URL
 * for the client to open. The message leaves from the participant's own phone;
 * this server never sends a text.
 */
export async function prepareSms(formData: FormData): Promise<SmsPrep> {
  try {
    const contactId = z.string().uuid().parse(formData.get("contactId"));
    const participantId = z.string().uuid().parse(formData.get("participantId"));
    const { participant } = await requireParticipantOwner(participantId);

    const [row] = await db
      .select({ contact: contacts, campaign: campaigns })
      .from(contacts)
      .innerJoin(campaigns, eq(campaigns.id, participant.campaignId))
      .where(and(eq(contacts.id, contactId), eq(contacts.participantId, participant.id)))
      .limit(1);
    if (!row) return { ok: false, message: "Contact not found." };

    const phone = decryptOptional(row.contact.phoneCiphertext, CTX.contactPhone);
    if (!phone) return { ok: false, message: "This contact has no phone number." };
    const name = decryptOptional(row.contact.nameCiphertext, CTX.contactName) ?? "";
    const first = name.split(" ")[0] ?? "";

    const code = await ensureContactShareLink(participant.id, row.campaign.id, row.contact.id, "sms");
    await db.insert(outreachEvents).values({ participantId: participant.id, contactId: row.contact.id, channel: "sms" });
    revalidatePath(`/dashboard/${participant.id}`);

    const body = `Hey${first ? ` ${first}` : ""}! I'm raising money for ${row.campaign.name} this season — anything helps and it's tax-deductible. Here's my page: ${siteUrl(`/r/${code}`)}`;
    return { ok: true, href: `sms:${phone}?&body=${encodeURIComponent(body)}` };
  } catch (err) {
    console.error("[sms] prepare failed:", err instanceof Error ? err.message : "unknown");
    return { ok: false, message: "Couldn't prepare that text." };
  }
}

export async function recordCopy(formData: FormData): Promise<void> {
  try {
    const participantId = z.string().uuid().parse(formData.get("participantId"));
    const { participant } = await requireParticipantOwner(participantId);
    await db.insert(outreachEvents).values({ participantId: participant.id, channel: "copy_link" });
  } catch {
    // analytics only
  }
}

// ---------------------------------------------------------------- contacts: paste a list

/** Same parser as CSV — "Name, email, phone" per line in any order — but from a textarea, which is what works on a phone. */
export async function pasteContacts(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const participantId = z.string().uuid().parse(formData.get("participantId"));
    const { participant } = await requireParticipantOwner(participantId);
    if (!(await limiters.contactImport.limit(participant.id)).success) return { ok: false, message: "Too many imports this hour. Try again later." };
    if (!checkbox(formData.get("attest"))) return { ok: false, message: "Please confirm these are your own contacts." };

    const pasted = z.string().max(MAX_CSV_BYTES, "That's too much at once — paste fewer lines.").parse(formData.get("pasted") ?? "");
    if (!pasted.trim()) return { ok: false, message: "Paste at least one line: name, email, phone." };

    const result = parseContactsCsv(pasted);
    const { inserted, duplicates, overCap } = await insertContacts(participant.id, result.contacts, "manual");
    await db.insert(contactImports).values({
      participantId: participant.id,
      originalFilename: null,
      byteSize: pasted.length,
      rowCount: result.rowCount,
      importedCount: inserted,
      skippedCount: result.skipped + duplicates + overCap,
      attestedConsent: true,
      errorSummary: result.errors.join(" ") || null,
    });

    revalidatePath(`/dashboard/${participant.id}`);
    const notes: string[] = [];
    if (duplicates) notes.push(`${duplicates} already on your list`);
    if (result.skipped) notes.push(`${result.skipped} lines had no usable name, email or phone`);
    if (overCap) notes.push(`${overCap} not added — the list holds ${CONTACT_CAP}`);
    return { ok: inserted > 0, message: inserted > 0 ? `Added ${inserted} contact${inserted === 1 ? "" : "s"}.${notes.length ? ` (${notes.join("; ")}.)` : ""}` : `Nothing added. ${notes.join("; ") || "Each line needs a name plus an email or phone."}` };
  });
}

// ---------------------------------------------------------------- family helpers

async function helperContext(participantId: string) {
  const { user, participant } = await requireParticipantOwner(participantId);
  const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, participant.campaignId)).limit(1);
  if (!campaign) throw new Error("Campaign not found.");
  const [org] = await db.select().from(organizations).where(eq(organizations.id, campaign.orgId)).limit(1);
  if (!org) throw new Error("Organization not found.");
  return { user, participant, campaign, org };
}

const HelperInput = z.object({
  participantId: z.string().uuid(),
  name: z.string().trim().min(1, "Their name is required").max(80),
  email: z.email("Enter a valid email").max(200),
  relationship: z.string().trim().max(40).optional(),
});

export async function addHelper(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const input = HelperInput.parse(Object.fromEntries(formData));
    const ctx = await helperContext(input.participantId);
    if (!(await limiters.mutation.limit(`helper:${ctx.participant.id}`)).success) return { ok: false, message: "Slow down a little." };
    if (ctx.campaign.status !== "active") return { ok: false, message: "Helpers can be added once the campaign is live." };
    try {
      const { kitSent } = await createHelper(ctx, { name: input.name, email: input.email, relationship: input.relationship ?? null });
      revalidatePath(`/dashboard/${ctx.participant.id}`);
      return { ok: true, message: kitSent ? `${input.name.split(" ")[0]} is in. Their share kit is on its way.` : `${input.name.split(" ")[0]} is in, but the kit email failed — try "Resend kit" in a minute.` };
    } catch (err) {
      if (err instanceof HelperError) return { ok: false, message: err.message };
      throw err;
    }
  });
}

export async function resendHelperKit(formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const helperId = z.string().uuid().parse(formData.get("helperId"));
    const participantId = z.string().uuid().parse(formData.get("participantId"));
    const ctx = await helperContext(participantId);
    // Scoped by owner: a foreign helper id finds nothing.
    const [helper] = await db.select().from(participantHelpers).where(and(eq(participantHelpers.id, helperId), eq(participantHelpers.participantId, ctx.participant.id))).limit(1);
    if (!helper) return { ok: false, message: "Helper not found." };
    try {
      await sendKit(ctx, helper);
      revalidatePath(`/dashboard/${ctx.participant.id}`);
      return { ok: true, message: "Kit re-sent." };
    } catch (err) {
      if (err instanceof HelperError) return { ok: false, message: err.message };
      throw err;
    }
  });
}

export async function removeHelper(formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const helperId = z.string().uuid().parse(formData.get("helperId"));
    const participantId = z.string().uuid().parse(formData.get("participantId"));
    const { participant } = await requireParticipantOwner(participantId);
    await db.delete(participantHelpers).where(and(eq(participantHelpers.id, helperId), eq(participantHelpers.participantId, participant.id)));
    revalidatePath(`/dashboard/${participant.id}`);
    return { ok: true, message: "Removed." };
  });
}
