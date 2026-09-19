import { Avatar, card } from "@/components/ui";
import { formatMoneyShort } from "@/lib/money";
import { listDonorsForParticipant } from "@/lib/queries/donations";

/** The participant's donors: names, gifts, notes. No emails — thank them by name. */
export async function Supporters({ participantId }: { participantId: string }) {
  const donors = await listDonorsForParticipant(participantId);
  return (
    <section>
      <h2 className="mb-3 font-display text-2xl font-bold uppercase">Your supporters</h2>
      {donors.length === 0 ? (
        <p className="text-sm text-muted">Nobody yet. Share your link — the first gift usually comes from someone who already knows you.</p>
      ) : (
        <ul className="space-y-2">
          {donors.map((d) => (
            <li key={d.id} className={`${card} flex gap-3 p-3.5 ${d.status === "pending" ? "opacity-70" : ""}`}>
              <Avatar name={d.donorName ?? "A"} size={36} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-semibold">{d.donorName ?? "Anonymous"}</span>
                  <span className="font-bold tabular-nums text-carolina-600 dark:text-carolina-300">{formatMoneyShort(d.amountCents)}</span>
                  <span className="text-xs text-muted">{d.agoLabel}</span>
                  {d.status === "pending" ? <span className="text-xs text-amber-700 dark:text-amber-300">bank transfer settling</span> : null}
                </div>
                {d.message ? <p className="mt-1 text-sm text-muted">&ldquo;{d.message}&rdquo;</p> : null}
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-sm text-muted">Thank each of them personally. It is the highest-return thing you can do for next season.</p>
    </section>
  );
}
