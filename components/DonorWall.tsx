import Link from "next/link";
import { formatMoneyShort } from "@/lib/money";
import { Avatar, card } from "./ui";

type Donation = {
  id: string;
  amountCents: number;
  donorName: string | null;
  message: string | null;
  createdAt: Date;
  participantName?: string | null;
  participantSlug?: string | null;
};

const relative = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

function ago(date: Date): string {
  const seconds = Math.round((date.getTime() - Date.now()) / 1000);
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60],
  ];
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) {
      return relative.format(Math.round(seconds / size), unit);
    }
  }
  return "just now";
}

export function DonorWall({
  donations,
  showPlayer = false,
}: {
  donations: Donation[];
  showPlayer?: boolean;
}) {
  if (donations.length === 0) {
    return (
      <p className="text-sm text-muted">
        No donations yet — be the first to give.
      </p>
    );
  }

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
                <span className="font-bold tabular-nums text-carolina-600 dark:text-carolina-300">
                  {formatMoneyShort(d.amountCents)}
                </span>
                <span className="text-xs text-muted">{ago(d.createdAt)}</span>
              </div>

              {showPlayer && d.participantName && d.participantSlug ? (
                <div className="mt-0.5 text-xs text-muted">
                  for{" "}
                  <Link
                    href={`/p/${d.participantSlug}`}
                    className="underline underline-offset-2 hover:text-carolina-500"
                  >
                    {d.participantName}
                  </Link>
                </div>
              ) : null}

              {d.message ? (
                <p className="mt-1.5 text-sm leading-relaxed text-muted">
                  &ldquo;{d.message}&rdquo;
                </p>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
