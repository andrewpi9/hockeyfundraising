import Link from "next/link";
import { formatMoneyShort } from "@/lib/money";
import type { WallEntry } from "@/lib/queries/donations";
import { Avatar, card } from "./ui";

/** Pure: everything time-dependent (agoLabel) and every decryption happened in the query. */
export function DonorWall({ donations, showParticipant = false, campaignSlug }: { donations: WallEntry[]; showParticipant?: boolean; campaignSlug?: string }) {
  if (donations.length === 0) return <p className="text-sm text-muted">No donations yet — be the first to give.</p>;

  return (
    <ul className="space-y-2">
      {donations.map((d) => {
        const name = d.donorName ?? "Anonymous";
        return (
          <li key={d.id} className={`${card} flex gap-3 p-3.5`}>
            <Avatar name={d.donorName ?? "A"} size={36} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span className="font-semibold">{name}</span>
                <span className="font-display text-lg font-bold tabular-nums text-carolina-600 dark:text-carolina-300">{formatMoneyShort(d.amountCents)}</span>
                <span className="text-xs text-muted">{d.agoLabel}</span>
              </div>
              {showParticipant && d.participantName && d.participantSlug && campaignSlug ? (
                <div className="mt-0.5 text-xs text-muted">
                  for <Link href={`/c/${campaignSlug}/${d.participantSlug}`} className="underline underline-offset-2 hover:text-carolina-500">{d.participantName}</Link>
                </div>
              ) : null}
              {d.message ? <p className="mt-1.5 text-sm leading-relaxed text-muted">&ldquo;{d.message}&rdquo;</p> : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
