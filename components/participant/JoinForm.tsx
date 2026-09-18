"use client";

import { useActionState } from "react";
import { joinCampaign, acceptInvite } from "@/app/dashboard/actions";
import { Button, Field, inputStyles } from "@/components/ui";
import { Notice } from "@/components/admin/CampaignForm";

export function JoinForm() {
  const [state, action, pending] = useActionState(joinCampaign, null);
  return (
    <form action={action} className="mt-4 flex flex-wrap items-end gap-3">
      <div className="min-w-[200px] flex-1">
        <Field label="Join code">
          <input
            name="code"
            required
            maxLength={7}
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            placeholder="ABC234"
            className={`${inputStyles} font-mono text-lg uppercase tracking-widest`}
          />
        </Field>
      </div>
      <Button type="submit" disabled={pending}>{pending ? "Joining…" : "Join"}</Button>
      <div className="basis-full"><Notice state={state} /></div>
    </form>
  );
}

export function AcceptInviteForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(acceptInvite, null);
  return (
    <form action={action} className="mt-6">
      <input type="hidden" name="token" value={token} />
      <Button type="submit" disabled={pending} className="w-full">{pending ? "Joining…" : "Accept and join"}</Button>
      <Notice state={state} />
    </form>
  );
}
