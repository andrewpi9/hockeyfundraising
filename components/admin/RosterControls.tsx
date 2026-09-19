"use client";

import { useActionState, useState, useTransition } from "react";
import { inviteParticipant, revokeInvite, removeParticipant, reassignDonation, nudgeQuietParticipants } from "@/app/admin/actions";
import type { ActionState } from "@/lib/actions";
import { Button, Field, inputStyles } from "@/components/ui";
import { Notice } from "./CampaignForm";

export function InviteForm({ campaignId }: { campaignId: string }) {
  const [state, action, pending] = useActionState(inviteParticipant, null);
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="campaignId" value={campaignId} />
      <div className="min-w-[240px] flex-1">
        <Field label="Invite by email" hint="They'll get a link that only works for that address.">
          <input name="email" type="email" required placeholder="player@unc.edu" className={inputStyles} />
        </Field>
      </div>
      <Button type="submit" variant="outline" disabled={pending}>{pending ? "Sending…" : "Send invite"}</Button>
      <div className="basis-full"><Notice state={state} /></div>
    </form>
  );
}

export function RevokeInviteButton({ inviteId }: { inviteId: string }) {
  const [pending, start] = useTransition();
  const [state, setState] = useState<ActionState>(null);
  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          const fd = new FormData();
          fd.set("inviteId", inviteId);
          start(async () => setState(await revokeInvite(fd)));
        }}
        className="text-xs text-muted hover:text-red-600"
      >
        Revoke
      </button>
      {state && !state.ok ? <span className="text-xs text-red-600">{state.message}</span> : null}
    </span>
  );
}

export function RemoveParticipantButton({ participantId, name }: { participantId: string; name: string }) {
  const [pending, start] = useTransition();
  const [state, setState] = useState<ActionState>(null);
  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          if (!window.confirm(`Remove ${name} from this campaign? Their page goes offline; donations already attributed to them stay in the totals.`)) return;
          const fd = new FormData();
          fd.set("participantId", participantId);
          start(async () => setState(await removeParticipant(fd)));
        }}
        className="text-xs text-muted hover:text-red-600"
      >
        Remove
      </button>
      {state && !state.ok ? <span className="text-xs text-red-600">{state.message}</span> : null}
    </span>
  );
}

/** Inline invite that hands an imported row to its real owner. */
export function ClaimInviteForm({ campaignId, participantId }: { campaignId: string; participantId: string }) {
  const [state, action, pending] = useActionState(inviteParticipant, null);
  if (state?.ok) return <span className="text-xs text-carolina-700 dark:text-carolina-300">invite sent</span>;
  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="campaignId" value={campaignId} />
      <input type="hidden" name="participantId" value={participantId} />
      <input name="email" type="email" required placeholder="their email" aria-label="Email to invite" className={`${inputStyles} h-8 w-44 px-2 py-1 text-xs`} />
      <Button type="submit" variant="outline" disabled={pending} className="h-8 px-2.5 py-1 text-xs">{pending ? "…" : "Send claim invite"}</Button>
      {state && !state.ok ? <span className="text-xs text-red-600">{state.message}</span> : null}
    </form>
  );
}

export function ReassignSelect({ donationId, current, roster }: { donationId: string; current: string | null; roster: { id: string; displayName: string }[] }) {
  const [pending, start] = useTransition();
  const [state, setState] = useState<ActionState>(null);
  return (
    <span className="inline-flex flex-col gap-1">
      <select
        aria-label="Credit this gift to"
        defaultValue={current ?? ""}
        disabled={pending}
        onChange={(e) => {
          const fd = new FormData();
          fd.set("donationId", donationId);
          fd.set("participantId", e.target.value);
          start(async () => setState(await reassignDonation(fd)));
        }}
        className={`${inputStyles} h-8 w-44 px-2 py-1 text-xs`}
      >
        <option value="">Team (no player)</option>
        {roster.map((r) => (
          <option key={r.id} value={r.id}>
            {r.displayName}
          </option>
        ))}
      </select>
      {state ? <span className={`text-[11px] ${state.ok ? "text-carolina-700 dark:text-carolina-300" : "text-red-600"}`}>{state.message}</span> : null}
    </span>
  );
}

export function NudgeButton({ campaignId, quietCount }: { campaignId: string; quietCount: number }) {
  const [pending, start] = useTransition();
  const [state, setState] = useState<ActionState>(null);
  if (quietCount === 0 && !state) return <span className="text-sm text-muted">Every signed-in player has shared at least once.</span>;
  return (
    <span className="inline-flex items-center gap-3">
      <Button
        type="button"
        variant="outline"
        disabled={pending || quietCount === 0}
        onClick={() => {
          if (!window.confirm(`Email ${quietCount} player${quietCount === 1 ? "" : "s"} who haven't shared yet?`)) return;
          const fd = new FormData();
          fd.set("campaignId", campaignId);
          start(async () => setState(await nudgeQuietParticipants(fd)));
        }}
      >
        {pending ? "Sending…" : `Nudge ${quietCount} who haven't shared`}
      </Button>
      {state ? <span className={`text-sm ${state.ok ? "text-carolina-700 dark:text-carolina-300" : "text-red-600"}`}>{state.message}</span> : null}
    </span>
  );
}
