"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { verifyUnsubscribeToken } from "@/lib/crypto";
import { applyUnsubscribe } from "@/lib/unsubscribe";
import { limiters } from "@/lib/ratelimit";

export type UnsubState = { done: boolean; message: string } | null;

/** Human path: the confirm button on /unsubscribe/[token]. No login, by design. */
export async function confirmUnsubscribe(_prev: UnsubState, formData: FormData): Promise<UnsubState> {
  const token = z.string().max(200).parse(formData.get("token"));
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!(await limiters.mutation.limit(`unsub:${ip}`)).success) return { done: false, message: "Please try again in a minute." };

  const contactId = verifyUnsubscribeToken(token);
  if (!contactId) return { done: false, message: "This link isn't valid." };
  const applied = await applyUnsubscribe(contactId, "unsubscribed", ip);
  return applied ? { done: true, message: "You've been unsubscribed. You won't receive further email from this organization's fundraisers." } : { done: false, message: "This link isn't valid." };
}
