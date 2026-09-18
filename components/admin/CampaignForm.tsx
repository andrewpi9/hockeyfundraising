"use client";

import { useActionState } from "react";
import type { ActionState } from "@/lib/actions";
import { Button, Field, inputStyles } from "@/components/ui";

export function Notice({ state }: { state: ActionState }) {
  if (!state) return null;
  return (
    <p
      role="status"
      className={`mt-3 rounded-xl px-3 py-2 text-sm ${
        state.ok
          ? "bg-carolina-50 text-carolina-800 dark:bg-navy-800 dark:text-carolina-200"
          : "bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-300"
      }`}
    >
      {state.message}
    </p>
  );
}

export function CampaignForm({
  action,
  campaignId,
  defaults,
  submitLabel,
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  campaignId?: string;
  defaults?: {
    name: string;
    description: string;
    goal: string;
    startsAt: string;
    endsAt: string;
    allowFeeCover: boolean;
  };
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState(action, null);

  return (
    <form action={formAction} className="space-y-4">
      {campaignId ? <input type="hidden" name="campaignId" value={campaignId} /> : null}

      <Field label="Campaign name">
        <input
          name="name"
          required
          minLength={2}
          maxLength={120}
          defaultValue={defaults?.name ?? ""}
          placeholder="2026–27 Season Fund"
          className={inputStyles}
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Goal (dollars)" hint="Leave blank for no public goal.">
          <input
            name="goal"
            inputMode="decimal"
            defaultValue={defaults?.goal ?? ""}
            placeholder="25000"
            className={inputStyles}
          />
        </Field>
        <Field label="Starts">
          <input name="startsAt" type="date" defaultValue={defaults?.startsAt ?? ""} className={inputStyles} />
        </Field>
        <Field label="Ends" hint="Optional.">
          <input name="endsAt" type="date" defaultValue={defaults?.endsAt ?? ""} className={inputStyles} />
        </Field>
      </div>

      <Field
        label="Where the money goes"
        hint="Itemize. 'Ice time is $340/hour and the season needs 60 hours' raises more than 'support the program'."
      >
        <textarea
          name="description"
          rows={7}
          maxLength={5000}
          defaultValue={defaults?.description ?? ""}
          className={`${inputStyles} resize-y`}
        />
      </Field>

      <label className="flex cursor-pointer items-start gap-3 text-sm">
        <input
          type="checkbox"
          name="allowFeeCover"
          defaultChecked={defaults?.allowFeeCover ?? true}
          className="mt-0.5 size-4 accent-carolina-500"
        />
        <span>
          <span className="font-medium">Offer donors the option to cover card processing</span>
          <span className="block text-muted">
            Pre-checked at checkout. Most donors leave it on, which brings the org&rsquo;s net close to
            100%. The platform fee itself is 0% and is shown to every donor before they pay.
          </span>
        </span>
      </label>

      <Notice state={state} />
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : submitLabel}
      </Button>
    </form>
  );
}
