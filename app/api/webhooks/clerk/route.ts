import type { NextRequest } from "next/server";
import { verifyWebhook } from "@clerk/nextjs/webhooks";
import { upsertUserFromClerk, softDeleteUserFromClerk } from "@/lib/authz";
import { claimWebhookEvent, settleWebhookEvent, failWebhookEvent } from "@/lib/webhook-ledger";

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

  // Svix retries; the (provider, event_id) ledger makes replays no-ops and lets a failed attempt retry.
  const eventId = req.headers.get("svix-id") ?? `${evt.type}:${evt.data.id}`;
  const ledgerId = await claimWebhookEvent("clerk", eventId, evt.type);
  if (!ledgerId) return Response.json({ received: true, duplicate: true });

  try {
    switch (evt.type) {
      case "user.created":
      case "user.updated": {
        const d = evt.data;
        // Only a verified address may become identity; an unverified one could be anyone's.
        const verified = d.email_addresses.filter((e) => e.verification?.status === "verified");
        const primary = verified.find((e) => e.id === d.primary_email_address_id)?.email_address ?? verified[0]?.email_address;
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
        await settleWebhookEvent(ledgerId, "ignored");
        return Response.json({ received: true, ignored: true });
    }

    await settleWebhookEvent(ledgerId, "processed");
    return Response.json({ received: true });
  } catch (err) {
    await failWebhookEvent(ledgerId, err);
    return Response.json({ error: "Handler failed" }, { status: 500 });
  }
}
