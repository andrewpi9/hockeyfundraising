import { and, eq } from "drizzle-orm";
import { db } from "./db";
import { webhookEvents } from "./db/schema";

/**
 * At-least-once delivery, once-only processing.
 *
 * Claims (provider, eventId). Returns the ledger id to process, or null when
 * the event was already processed/ignored. A row left in `failed` by a
 * previous attempt is re-claimed, so a transient database or email error does
 * not strand the event: the provider's retry gets to try again instead of
 * being told "duplicate". The app's database role can INSERT and UPDATE this
 * table but never DELETE (scripts/grants.sql), which is why failure is a
 * status, not a removed row.
 */
export async function claimWebhookEvent(provider: string, eventId: string, type: string): Promise<string | null> {
  const inserted = await db
    .insert(webhookEvents)
    .values({ provider, eventId, type })
    .onConflictDoNothing()
    .returning({ id: webhookEvents.id });
  if (inserted[0]) return inserted[0].id;

  const reclaimed = await db
    .update(webhookEvents)
    .set({ status: "received", errorMessage: null })
    .where(and(eq(webhookEvents.provider, provider), eq(webhookEvents.eventId, eventId), eq(webhookEvents.status, "failed")))
    .returning({ id: webhookEvents.id });
  return reclaimed[0]?.id ?? null;
}

export async function settleWebhookEvent(ledgerId: string, outcome: "processed" | "ignored"): Promise<void> {
  await db
    .update(webhookEvents)
    .set({ status: outcome, processedAt: new Date() })
    .where(and(eq(webhookEvents.id, ledgerId), eq(webhookEvents.status, "received")));
}

/** Message only — a webhook payload carries PII and is never stored. */
export async function failWebhookEvent(ledgerId: string, err: unknown): Promise<void> {
  await db
    .update(webhookEvents)
    .set({ status: "failed", errorMessage: err instanceof Error ? err.message.slice(0, 500) : "unknown" })
    .where(eq(webhookEvents.id, ledgerId));
}
