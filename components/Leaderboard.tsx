import Link from "next/link";
import { formatMoneyShort } from "@/lib/money";
import { Avatar, card } from "./ui";

export type LeaderboardRow = {
  id: string;
  slug: string;
  displayName: string;
  photoUrl: string | null;
  teamRole: string | null;
  goalCents: number;
  raisedCents: number;
  donorCount: number;
};

export function Leaderboard({ rows, campaignSlug }: { rows: LeaderboardRow[]; campaignSlug: string }) {
  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted">
        No players have joined this campaign yet.
      </p>
    );
  }

  return (
    <ol className="space-y-2">
      {rows.map((row, i) => {
        const pct =
          row.goalCents > 0
            ? Math.min(100, (row.raisedCents / row.goalCents) * 100)
            : 0;

        return (
          <li key={row.id}>
            <Link
              href={`/c/${campaignSlug}/${row.slug}`}
              className={`${card} flex items-center gap-3 p-3 transition hover:border-carolina-300 hover:shadow-md`}
            >
              <span className="w-6 shrink-0 text-center text-sm font-bold tabular-nums text-muted">
                {i + 1}
              </span>
              <Avatar src={row.photoUrl} name={row.displayName} size={44} />

              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="truncate font-semibold">{row.displayName}</span>
                  {row.teamRole ? (
                    <span className="shrink-0 text-xs text-muted">{row.teamRole}</span>
                  ) : null}
                </div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-carolina-100 dark:bg-navy-800">
                  <div
                    className="animate-fill h-full rounded-full bg-carolina-400"
                    style={{ width: `${Math.max(pct, pct > 0 ? 2 : 0)}%` }}
                  />
                </div>
              </div>

              <div className="shrink-0 text-right">
                <div className="font-bold tabular-nums">
                  {formatMoneyShort(row.raisedCents)}
                </div>
                <div className="text-xs text-muted">
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
