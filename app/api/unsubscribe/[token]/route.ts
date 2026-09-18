import { verifyUnsubscribeToken } from "@/lib/crypto";
import { applyUnsubscribe } from "@/lib/unsubscribe";
import { limiters, clientIp } from "@/lib/ratelimit";

/**
 * RFC 8058 one-click unsubscribe. Mail clients POST here from the
 * List-Unsubscribe header with no user interaction, so this must succeed
 * without a page, a cookie or a login — and must never be a GET.
 */
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const ip = clientIp(req);
  if (!(await limiters.mutation.limit(`unsub:${ip}`)).success) return new Response("Too many requests", { status: 429 });

  const { token } = await params;
  const contactId = verifyUnsubscribeToken(token);
  if (!contactId) return new Response("Invalid", { status: 400 });

  await applyUnsubscribe(contactId, "unsubscribed", ip);
  return new Response("Unsubscribed", { status: 200 });
}
