import { ZodError } from "zod";
import { AuthError } from "./authz";

export type ActionState =
  | { ok: true; message: string; id?: string }
  | { ok: false; message: string }
  | null;

/**
 * Wraps a Server Action body. Auth and validation failures become form state;
 * anything else is logged by MESSAGE ONLY — never the error object, which can
 * carry the FormData and therefore PII — and reported generically.
 *
 * `redirect()` must be called by the caller AFTER this returns: it works by
 * throwing, and a catch here would swallow it.
 */
export async function runAction(body: () => Promise<ActionState>): Promise<ActionState> {
  try {
    return await body();
  } catch (err) {
    if (err instanceof AuthError) {
      return {
        ok: false,
        message: err.code === "UNAUTHENTICATED" ? "Please sign in." : "You don't have permission to do that.",
      };
    }
    if (err instanceof ZodError) {
      return { ok: false, message: err.issues[0]?.message ?? "Please check the form." };
    }
    console.error("[action]", err instanceof Error ? err.message : "unknown error");
    return { ok: false, message: "Something went wrong. Please try again." };
  }
}

/** Reads a checkbox: browsers send "on" when checked and omit it when not. */
export const checkbox = (v: unknown) => v === "on" || v === "true" || v === true;

/** `<input type="date">` gives YYYY-MM-DD; pin to noon UTC so no timezone shifts the day. */
export function dateInput(v: unknown): Date | null {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(`${v}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export const toDateInput = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : "");
