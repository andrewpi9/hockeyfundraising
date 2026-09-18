"use client";

import { useActionState } from "react";
import { addPlayer, updateCampaign, type ActionState } from "@/app/dashboard/actions";
import { Button, Field, inputStyles } from "./ui";

function Notice({ state }: { state: ActionState }) {
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

export function AddPlayerForm() {
  const [state, action, pending] = useActionState(addPlayer, null);

  return (
    <form action={action} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Player name">
          <input name="name" required placeholder="Chris Miller" className={inputStyles} />
        </Field>
        <Field label="Email" hint="This becomes their sign-in.">
          <input
            name="email"
            type="email"
            required
            placeholder="cmiller@unc.edu"
            className={inputStyles}
          />
        </Field>
      </div>
      <Field label="Personal goal (optional)">
        <input name="goal" inputMode="decimal" placeholder="500" className={inputStyles} />
      </Field>

      <Notice state={state} />
      <Button type="submit" disabled={pending}>
        {pending ? "Adding…" : "Add player"}
      </Button>
    </form>
  );
}

export function CampaignForm({
  defaults,
}: {
  defaults: {
    name: string;
    tagline: string;
    story: string;
    goal: string;
    endsAt: string;
  };
}) {
  const [state, action, pending] = useActionState(updateCampaign, null);

  return (
    <form action={action} className="space-y-3">
      <Field label="Campaign name">
        <input name="name" required defaultValue={defaults.name} className={inputStyles} />
      </Field>
      <Field label="Tagline">
        <input
          name="tagline"
          defaultValue={defaults.tagline}
          placeholder="2026 Season Fund"
          className={inputStyles}
        />
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Team goal (dollars)">
          <input
            name="goal"
            inputMode="decimal"
            defaultValue={defaults.goal}
            className={inputStyles}
          />
        </Field>
        <Field label="End date">
          <input
            name="endsAt"
            type="date"
            defaultValue={defaults.endsAt}
            className={inputStyles}
          />
        </Field>
      </div>

      <Field
        label="Where the money goes"
        hint="Be specific and itemized. 'Ice time is $340 an hour' raises more than 'support our program.'"
      >
        <textarea
          name="story"
          rows={7}
          defaultValue={defaults.story}
          className={`${inputStyles} resize-y`}
        />
      </Field>

      <Notice state={state} />
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save campaign"}
      </Button>
    </form>
  );
}
