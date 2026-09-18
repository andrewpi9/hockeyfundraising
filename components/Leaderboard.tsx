import Link from "next/link";
import { formatMoneyShort } from "@/lib/money";
import { Avatar, card } from "./ui";

export type LeaderboardRow = {
  id: string;
  slug: string;
  displayName: string;
  photoUrl: string | null;
  teamRole: string | null;
  rosterNumber: string | null;
  goalCents: number;
  raisedCents: number;
  donorCount: number;
};

export function Leaderboard({ rows, campaignSlug }: { rows: LeaderboardRow[]; campaignSlug: string }) {
  if (rows.length === 0) return <p className="text-sm text-muted">No players have joined this campaign yet.</p>;

  return (
    <ol className="space-y-2">
      {rows.map((row, i) => {
        const rank = i + 1;
        const podium = rank <= 3 && row.raisedCents > 0;
        const pct = row.goalCents > 0 ? Math.min(100, (row.raisedCents / row.goalCents) * 100) : 0;

        return (
          <li key={row.id}>
            <Link href={`/c/${campaignSlug}/${row.slug}`} className={`${card} flex items-center gap-3 p-3 transition hover:border-carolina-300 hover:shadow-md sm:gap-4`}>
              <span className={`grid size-7 shrink-0 place-items-center rounded-full font-display text-sm font-bold tabular-nums ${podium ? "bg-carolina-400 text-navy-950" : "text-muted"}`}>
                {rank}
              </span>
              <Avatar src={row.photoUrl} name={row.displayName} size={52} />

              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="truncate font-semibold">{row.displayName}</span>
                  {row.rosterNumber ? <span className="shrink-0 font-display text-sm font-semibold text-carolina-600 dark:text-carolina-300">#{row.rosterNumber}</span> : null}
                  {row.teamRole ? <span className="hidden shrink-0 text-xs text-muted sm:inline">{row.teamRole}</span> : null}
                </div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-carolina-100 dark:bg-navy-800">
                  <div className="animate-fill h-full rounded-full bg-gradient-to-r from-carolina-600 to-carolina-300" style={{ width: `${Math.max(pct, pct > 0 ? 2 : 0)}%` }} />
                </div>
              </div>

              <div className="shrink-0 text-right">
                <div className="font-display text-xl font-bold tabular-nums leading-none">{formatMoneyShort(row.raisedCents)}</div>
                <div className="mt-1 text-xs text-muted">
                  {row.donorCount} {row.donorCount === 1 ? "donor" : "donors"}
                </div>
              </div>
            </Link>
          </li>
        );
      })}
    </ol>
  );
}
