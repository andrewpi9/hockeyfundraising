"use client";

import { useActionState, useState, useTransition } from "react";
import { updateParticipantProfile, uploadPhoto, removePhoto } from "@/app/dashboard/actions";
import type { ActionState } from "@/lib/actions";
import { Avatar, Button, Field, inputStyles } from "@/components/ui";
import { Notice } from "@/components/admin/CampaignForm";

export function ProfileForm({
  participantId,
  defaults,
}: {
  participantId: string;
  defaults: { displayName: string; bio: string; goal: string; teamRole: string; rosterNumber: string; classYear: string };
}) {
  const [state, action, pending] = useActionState(updateParticipantProfile, null);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="participantId" value={participantId} />
      <Field label="Display name">
        <input name="displayName" required minLength={2} maxLength={80} defaultValue={defaults.displayName} className={inputStyles} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Number">
          <input name="rosterNumber" maxLength={4} defaultValue={defaults.rosterNumber} placeholder="88" className={`${inputStyles} font-display text-lg`} />
        </Field>
        <Field label="Position">
          <input name="teamRole" maxLength={40} defaultValue={defaults.teamRole} placeholder="Forward" className={inputStyles} />
        </Field>
        <Field label="Year">
          <input name="classYear" maxLength={12} defaultValue={defaults.classYear} placeholder="Junior" className={inputStyles} />
        </Field>
        <Field label="Personal goal ($)">
          <input name="goal" inputMode="decimal" maxLength={20} defaultValue={defaults.goal} placeholder="500" className={inputStyles} />
        </Field>
      </div>
      <Field label="Your story" hint="Two or three sentences in your own words. This is what moves people to give.">
        <textarea
          name="bio"
          rows={5}
          maxLength={2000}
          defaultValue={defaults.bio}
          placeholder="I'm a sophomore from Raleigh. Our season means 14 road trips and a lot of 6am ice…"
          className={`${inputStyles} resize-y`}
        />
      </Field>
      <Notice state={state} />
      <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save"}</Button>
    </form>
  );
}

export function PhotoUploader({ participantId, photoUrl, name }: { participantId: string; photoUrl: string | null; name: string }) {
  const [state, action, pending] = useActionState(uploadPhoto, null);
  const [removing, startRemove] = useTransition();
  const [removeState, setRemoveState] = useState<ActionState>(null);

  function remove() {
    const fd = new FormData();
    fd.set("participantId", participantId);
    startRemove(async () => setRemoveState(await removePhoto(fd)));
  }

  return (
    <div className="flex flex-col items-center gap-3 text-center">
      <Avatar src={photoUrl} name={name} size={128} />
      <form action={action} className="flex flex-col items-center gap-2">
        <input type="hidden" name="participantId" value={participantId} />
        <label className="cursor-pointer text-sm font-medium text-carolina-600 hover:underline dark:text-carolina-300">
          {photoUrl ? "Change photo" : "Add a photo"}
          <input
            type="file"
            name="photo"
            accept="image/jpeg,image/png,image/webp"
            className="sr-only"
            onChange={(e) => e.currentTarget.form?.requestSubmit()}
            disabled={pending}
          />
        </label>
        <span className="text-xs text-muted">JPEG, PNG or WebP · under 2 MB</span>
        {pending ? <span className="text-xs text-muted">Uploading…</span> : null}
      </form>
      {photoUrl ? (
        <button type="button" onClick={remove} disabled={removing} className="text-xs text-muted hover:text-red-600">
          Remove
        </button>
      ) : null}
      <Notice state={state ?? removeState} />
    </div>
  );
}
