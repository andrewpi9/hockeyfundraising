import { listHelpers, HELPER_CAP } from "@/lib/helpers";
import { formatMoneyShort } from "@/lib/money";
import { Avatar, card } from "@/components/ui";
import { AddHelperForm, ResendKitButton, RemoveHelperButton } from "./HelpersControls";

/** Server component. The player's own helpers, decrypted for the player only. */
export async function Helpers({ participantId, campaignActive }: { participantId: string; campaignActive: boolean }) {
  const helpers = await listHelpers(participantId);

  return (
    <section className={`${card} p-5`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-2xl font-bold uppercase">Family helpers</h2>
        <span className="text-sm tabular-nums text-muted">
          {helpers.length} / {HELPER_CAP}
        </span>
      </div>
      <p className="mt-1 text-sm text-muted">
        Your parents’ network is bigger than yours. Add a parent or relative and they get one email with your link, a note they can forward as-is, and your QR code — then they send it to
        relatives, coworkers and neighbors from their own email. Gifts that come through them show up here.
      </p>

      {helpers.length > 0 ? (
        <ul className="mt-5 divide-y divide-border">
          {helpers.map((h) => (
            <li key={h.id} className="flex flex-wrap items-center gap-3 py-3">
              <Avatar name={h.name} size={36} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{h.name}</span>
                  {h.relationship ? <span className="text-xs text-muted">{h.relationship}</span> : null}
                  {h.unsubscribed ? <span className="rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-700 dark:bg-red-950/40 dark:text-red-300">unsubscribed</span> : null}
                </div>
                <div className="truncate text-xs text-muted">
                  {h.email} · {h.kitSentAt ? `kit sent ${h.kitSentAt.toLocaleDateString()}${h.kitSendCount > 1 ? ` (×${h.kitSendCount})` : ""}` : "kit not sent yet"}
                </div>
              </div>
              <div className="shrink-0 text-right text-xs text-muted">
                <div><strong className="font-display text-base text-fg">{h.clicks}</strong> clicks</div>
                <div><strong className="font-display text-base text-fg">{h.gifts}</strong> {h.gifts === 1 ? "gift" : "gifts"}{h.raisedCents ? ` · ${formatMoneyShort(h.raisedCents)}` : ""}</div>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                {!h.unsubscribed ? <ResendKitButton participantId={participantId} helperId={h.id} canResend={h.canResend} /> : null}
                <RemoveHelperButton participantId={participantId} helperId={h.id} name={h.name} />
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      {helpers.length < HELPER_CAP ? (
        <div className={`${helpers.length ? "mt-5 border-t border-border pt-5" : "mt-5"}`}>
          {!campaignActive ? <p className="mb-3 text-xs text-muted">You can add helpers once the campaign launches.</p> : null}
          <AddHelperForm participantId={participantId} disabled={!campaignActive} />
        </div>
      ) : null}
    </section>
  );
}
