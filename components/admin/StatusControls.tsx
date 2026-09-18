"use client";

import { useState, useTransition } from "react";
import { setCampaignStatus, rotateJoinCode } from "@/app/admin/actions";
import type { ActionState } from "@/lib/actions";
import { Button } from "@/components/ui";
import { Notice } from "./CampaignForm";

type Status = "draft" | "active" | "closed";

export function StatusControls({ campaignId, status }: { campaignId: string; status: Status }) {
  const [pending, start] = useTransition();
  const [state, setState] = useState<ActionState>(null);

  function change(next: Status) {
    if (next === "closed" && !window.confirm("Close this campaign? Donations will stop and it cannot be reopened as active without a status change here.")) return;
    const fd = new FormData();
    fd.set("campaignId", campaignId);
    fd.set("status", next);
    start(async () => setState(await setCampaignStatus(fd)));
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {status !== "active" ? (
          <Button type="button" onClick={() => change("active")} disabled={pending}>
            {status === "draft" ? "Launch campaign" : "Reopen"}
          </Button>
        ) : null}
        {status === "active" ? (
          <Button type="button" variant="outline" onClick={() => change("closed")} disabled={pending}>
            Close campaign
          </Button>
        ) : null}
        {status === "active" || status === "closed" ? (
          <Button type="button" variant="ghost" onClick={() => change("draft")} disabled={pending}>
            Back to draft
          </Button>
        ) : null}
      </div>
      <Notice state={state} />
    </div>
  );
}

export function JoinCodeCard({ campaignId, code }: { campaignId: string; code: string }) {
  const [pending, start] = useTransition();
  const [state, setState] = useState<ActionState>(null);

  function rotate() {
    if (!window.confirm("Issue a new join code? Anyone holding the old one will no longer be able to join.")) return;
    const fd = new FormData();
    fd.set("campaignId", campaignId);
    start(async () => setState(await rotateJoinCode(fd)));
  }

  return (
    <div>
      <div className="flex items-center gap-3">
        <code className="rounded-xl border border-border bg-bg px-4 py-2 font-mono text-2xl font-bold tracking-widest">
          {code}
        </code>
        <Button type="button" variant="ghost" onClick={rotate} disabled={pending}>
          Rotate
        </Button>
      </div>
      <p className="mt-2 text-sm text-muted">
        Participants enter this code after signing in to join the campaign. Rotate it once the roster
        is set.
      </p>
      <Notice state={state} />
    </div>
  );
}
