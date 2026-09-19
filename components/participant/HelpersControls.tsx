"use client";

import { useActionState, useState, useTransition } from "react";
import { addHelper, resendHelperKit, removeHelper } from "@/app/dashboard/actions";
import type { ActionState } from "@/lib/actions";
import { Button, Field, inputStyles } from "@/components/ui";
import { Notice } from "@/components/admin/CampaignForm";

const RELATIONSHIPS = ["Parent", "Grandparent", "Sibling", "Aunt / Uncle", "Family friend", "Other"];

export function AddHelperForm({ participantId, disabled }: { participantId: string; disabled?: boolean }) {
  const [state, action, pending] = useActionState(addHelper, null);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="participantId" value={participantId} />
      <div className="grid gap-3 sm:grid-cols-[1fr_1.3fr_auto]">
        <Field label="Name"><input name="name" required maxLength={80} placeholder="Mom" className={inputStyles} disabled={disabled} /></Field>
        <Field label="Email"><input name="email" type="email" required placeholder="mom@example.com" className={inputStyles} disabled={disabled} /></Field>
        <Field label="Who">
          <select name="relationship" className={inputStyles} defaultValue="Parent" disabled={disabled}>
            {RELATIONSHIPS.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </Field>
      </div>
      <Notice state={state} />
      <Button type="submit" disabled={pending || disabled}>{pending ? "Sending their kit…" : "Add helper and send their kit"}</Button>
    </form>
  );
}

export function ResendKitButton({ participantId, helperId, canResend }: { participantId: string; helperId: string; canResend: boolean }) {
  const [pending, start] = useTransition();
  const [state, setState] = useState<ActionState>(null);
  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        disabled={pending || !canResend}
        onClick={() => {
          const fd = new FormData();
          fd.set("participantId", participantId);
          fd.set("helperId", helperId);
          start(async () => setState(await resendHelperKit(fd)));
        }}
        className="text-xs text-carolina-700 hover:underline disabled:cursor-not-allowed disabled:text-muted disabled:no-underline dark:text-carolina-300"
        title={canResend ? "Send the kit email again" : "Sent in the last 24 hours"}
      >
        {pending ? "Sending…" : "Resend kit"}
      </button>
      {state ? <span className={`text-xs ${state.ok ? "text-carolina-700 dark:text-carolina-300" : "text-red-600"}`}>{state.message}</span> : null}
    </span>
  );
}

export function RemoveHelperButton({ participantId, helperId, name }: { participantId: string; helperId: string; name: string }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        if (!window.confirm(`Remove ${name} as a helper? Their link stops being credited to them.`)) return;
        const fd = new FormData();
        fd.set("participantId", participantId);
        fd.set("helperId", helperId);
        start(async () => { await removeHelper(fd); });
      }}
      className="text-xs text-muted hover:text-red-600"
    >
      Remove
    </button>
  );
}
