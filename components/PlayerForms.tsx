"use client";

import { useActionState } from "react";
import {
  updateProfile,
  addContact,
  importContacts,
  type ActionState,
} from "@/app/me/actions";
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

export function ProfileForm({
  defaults,
}: {
  defaults: {
    displayName: string;
    bio: string;
    photoUrl: string;
    goal: string;
    jerseyNumber: string;
    position: string;
    gradYear: string;
  };
}) {
  const [state, action, pending] = useActionState(updateProfile, null);

  return (
    <form action={action} className="space-y-3">
      <Field label="Display name">
        <input
          name="displayName"
          required
          defaultValue={defaults.displayName}
          className={inputStyles}
        />
      </Field>

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Jersey #">
          <input
            name="jerseyNumber"
            defaultValue={defaults.jerseyNumber}
            className={inputStyles}
          />
        </Field>
        <Field label="Position">
          <input
            name="position"
            defaultValue={defaults.position}
            placeholder="Forward"
            className={inputStyles}
          />
        </Field>
        <Field label="Class year">
          <input
            name="gradYear"
            defaultValue={defaults.gradYear}
            placeholder="2028"
            className={inputStyles}
          />
        </Field>
      </div>

      <Field label="Personal goal" hint="In dollars. Leave blank for no goal.">
        <input
          name="goal"
          inputMode="decimal"
          defaultValue={defaults.goal}
          placeholder="500"
          className={inputStyles}
        />
      </Field>

      <Field label="Photo URL" hint="Paste a link to a headshot or action shot.">
        <input
          name="photoUrl"
          type="url"
          defaultValue={defaults.photoUrl}
          placeholder="https://…"
          className={inputStyles}
        />
      </Field>

      <Field
        label="Your story"
        hint="Two or three sentences in your own voice. This is what actually moves people to give."
      >
        <textarea
          name="bio"
          rows={5}
          defaultValue={defaults.bio}
          placeholder="I'm a sophomore defenseman from Raleigh. Our season means 14 road trips and a lot of 6am ice…"
          className={`${inputStyles} resize-y`}
        />
      </Field>

      <Notice state={state} />
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save profile"}
      </Button>
    </form>
  );
}

export function AddContactForm() {
  const [state, action, pending] = useActionState(addContact, null);

  return (
    <form action={action} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name">
          <input name="name" required placeholder="Aunt Sarah" className={inputStyles} />
        </Field>
        <Field label="Phone">
          <input
            name="phone"
            type="tel"
            placeholder="(919) 555-0199"
            className={inputStyles}
          />
        </Field>
      </div>
      <Field label="Email">
        <input
          name="email"
          type="email"
          placeholder="sarah@example.com"
          className={inputStyles}
        />
      </Field>

      <Notice state={state} />
      <Button type="submit" variant="outline" disabled={pending}>
        {pending ? "Adding…" : "Add contact"}
      </Button>
    </form>
  );
}

export function ImportContactsForm() {
  const [state, action, pending] = useActionState(importContacts, null);

  return (
    <form action={action} className="space-y-3">
      <Field
        label="Paste a list"
        hint="One person per line: name, email, phone — in any order. Commas or tabs both work, so a copied spreadsheet column pastes straight in."
      >
        <textarea
          name="pasted"
          rows={6}
          placeholder={"Aunt Sarah, sarah@example.com, 919-555-0199\nCoach Miller, miller@example.com\nGrandpa Joe, 704-555-0142"}
          className={`${inputStyles} resize-y font-mono text-sm`}
        />
      </Field>

      <Notice state={state} />
      <Button type="submit" variant="outline" disabled={pending}>
        {pending ? "Importing…" : "Import contacts"}
      </Button>
    </form>
  );
}
