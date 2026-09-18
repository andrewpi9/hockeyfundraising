import { Webhook } from "svix";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { emailInvites, webhookEvents } from "@/lib/db/schema";
import { applyUnsubscribe } from "@/lib/unsubscribe";

/** Shape per Resend's email.bounced docs: data.email_id is the id returned by emails.send(). */
type ResendEvent = {
  type: string;
  data: { email_id?: string; bounce?: { type?: "Permanent" | "Temporary" | string; subType?: string } };
};

const STATUS: Record<string, "delivered" | "bounced" | "complained" | undefined> = {
  "email.delivered": "delivered",
  "email.bounced": "bounced",
  "email.complained": "complained",
};

/**
 * Delivery feedback from Resend. Signed with Svix; an unsigned body never gets
 * past verify(). Hard bounces and complaints suppress the address org-wide —
 * continuing to mail a complainer is how a sending domain gets blacklisted.
 */
export async function POST(req: Request) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) return Response.json({ error: "Not configured" }, { status: 500 });

  const raw = await req.text();
  const svixHeaders = {
    "svix-id": req.headers.get("svix-id") ?? "",
    "svix-timestamp": req.headers.get("svix-timestamp") ?? "",
    "svix-signature": req.headers.get("svix-signature") ?? "",
  };

  // verify() throws on a bad signature or a stale timestamp; only then is the body trusted.
  try {
    new Webhook(secret).verify(raw, svixHeaders);
  } catch {
    return Response.json({ error: "Invalid signature" }, { status: 400 });
  }
  let event: ResendEvent;
  try {
    event = JSON.parse(raw) as ResendEvent;
  } catch {
    return Response.json({ error: "Malformed body" }, { status: 400 });
  }

  const eventId = svixHeaders["svix-id"] || `${event.type}:${event.data.email_id ?? "?"}`;
  const inserted = await db
    .insert(webhookEvents)
    .values({ provider: "resend", eventId, type: event.type })
    .onConflictDoNothing()
    .returning({ id: webhookEvents.id });
  if (inserted.length === 0) return Response.json({ received: true, duplicate: true });
  const ledgerId = inserted[0]!.id;

  try {
    const status = STATUS[event.type];
    const messageId = event.data.email_id;
    if (!status || !messageId) {
      await db.update(webhookEvents).set({ status: "ignored", processedAt: new Date() }).where(eq(webhookEvents.id, ledgerId));
      return Response.json({ received: true, ignored: true });
    }

    const [invite] = await db
      .select({ id: emailInvites.id, contactId: emailInvites.contactId })
      .from(emailInvites)
      .where(eq(emailInvites.providerMessageId, messageId))
      .limit(1);

    if (invite) {
      await db.update(emailInvites).set({ status }).where(eq(emailInvites.id, invite.id));
      // Resend classifies bounces as Permanent or Temporary (mailbox full, greylisting).
      // Only permanent ones and complaints suppress the address.
      const hard = status === "complained" || (status === "bounced" && event.data.bounce?.type !== "Temporary");
      if (hard) await applyUnsubscribe(invite.contactId, status === "complained" ? "complained" : "bounced");
    }

    await db
      .update(webhookEvents)
      .set({ status: "processed", processedAt: new Date() })
      .where(and(eq(webhookEvents.id, ledgerId), eq(webhookEvents.status, "received")));
    return Response.json({ received: true });
  } catch (err) {
    await db
      .update(webhookEvents)
      .set({ status: "failed", errorMessage: err instanceof Error ? err.message : "unknown" })
      .where(eq(webhookEvents.id, ledgerId));
    return Response.json({ error: "Handler failed" }, { status: 500 });
  }
}
