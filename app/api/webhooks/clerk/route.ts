import type { NextRequest } from "next/server";
import { verifyWebhook } from "@clerk/nextjs/webhooks";
import { eq, and } from "drizzle-orm";
import { db } from "@/lib/db";
import { webhookEvents } from "@/lib/db/schema";
import { upsertUserFromClerk, softDeleteUserFromClerk } from "@/lib/authz";

/**
 * Keeps `users` in sync with Clerk. verifyWebhook() checks the Svix signature
 * against CLERK_WEBHOOK_SIGNING_SECRET; an unsigned or tampered body never
 * reaches the switch below.
 */
export async function POST(req: NextRequest) {
  let evt: Awaited<ReturnType<typeof verifyWebhook>>;
  try {
    evt = await verifyWebhook(req);
  } catch {
    return Response.json({ error: "Invalid signature" }, { status: 400 });
  }

  // Svix retries; the (provider, event_id) unique index makes replays no-ops.
  const eventId = req.headers.get("svix-id") ?? `${evt.type}:${evt.data.id}`;
  const inserted = await db
    .insert(webhookEvents)
    .values({ provider: "clerk", eventId, type: evt.type })
    .onConflictDoNothing()
    .returning({ id: webhookEvents.id });
  if (inserted.length === 0) return Response.json({ received: true, duplicate: true });
  const ledgerId = inserted[0]!.id;

  try {
    switch (evt.type) {
      case "user.created":
      case "user.updated": {
        const d = evt.data;
        const primary =
          d.email_addresses.find((e) => e.id === d.primary_email_address_id)?.email_address ??
          d.email_addresses[0]?.email_address;
        if (!primary) break;
        await upsertUserFromClerk({
          clerkUserId: d.id,
          email: primary,
          name: [d.first_name, d.last_name].filter(Boolean).join(" ") || null,
          imageUrl: d.image_url ?? null,
        });
        break;
      }
      case "user.deleted": {
        if (evt.data.id) await softDeleteUserFromClerk(evt.data.id);
        break;
      }
      default:
        await db
          .update(webhookEvents)
          .set({ status: "ignored", processedAt: new Date() })
          .where(eq(webhookEvents.id, ledgerId));
        return Response.json({ received: true, ignored: true });
    }

    await db
      .update(webhookEvents)
      .set({ status: "processed", processedAt: new Date() })
      .where(and(eq(webhookEvents.id, ledgerId), eq(webhookEvents.status, "received")));
    return Response.json({ received: true });
  } catch (err) {
    // Message only — never the payload, which carries the user's email.
    await db
      .update(webhookEvents)
      .set({ status: "failed", errorMessage: err instanceof Error ? err.message : "unknown" })
      .where(eq(webhookEvents.id, ledgerId));
    return Response.json({ error: "Handler failed" }, { status: 500 });
  }
}
