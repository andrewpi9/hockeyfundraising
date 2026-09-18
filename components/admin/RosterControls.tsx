"use client";

import { useActionState, useState, useTransition } from "react";
import { inviteParticipant, revokeInvite, removeParticipant } from "@/app/admin/actions";
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
