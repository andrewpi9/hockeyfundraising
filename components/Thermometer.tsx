import { formatMoneyShort } from "@/lib/money";

export function Thermometer({
  raisedCents,
  goalCents,
  size = "lg",
  tone = "light",
}: {
  raisedCents: number;
  goalCents: number;
  size?: "sm" | "lg";
  /** "dark" for navy heroes. */
  tone?: "light" | "dark";
}) {
  const pct = goalCents > 0 ? Math.min(100, (raisedCents / goalCents) * 100) : 0;
  const large = size === "lg";
  const dark = tone === "dark";

  return (
    <div>
      <div className="flex items-end justify-between gap-3">
        <div className="leading-none">
          <span className={`font-display font-bold tabular-nums ${large ? "text-5xl sm:text-6xl" : "text-2xl"}`}>{formatMoneyShort(raisedCents)}</span>
          {goalCents > 0 ? (
            <span className={`ml-2 ${dark ? "text-carolina-200" : "text-muted"} ${large ? "text-lg" : "text-sm"}`}>of {formatMoneyShort(goalCents)}</span>
          ) : null}
        </div>
        {goalCents > 0 ? (
          <span className={`font-display font-semibold tabular-nums ${dark ? "text-carolina-300" : "text-carolina-600 dark:text-carolina-300"} ${large ? "text-2xl" : "text-sm"}`}>
            {Math.round(pct)}%
          </span>
        ) : null}
      </div>

      <div
        className={`mt-3 overflow-hidden rounded-full ${dark ? "bg-white/15" : "bg-carolina-100 dark:bg-navy-800"} ${large ? "h-4" : "h-2"}`}
        role="progressbar"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${formatMoneyShort(raisedCents)} raised of ${formatMoneyShort(goalCents)} goal`}
      >
        <div className="animate-fill h-full rounded-full bg-gradient-to-r from-carolina-600 via-carolina-400 to-carolina-200" style={{ width: `${Math.max(pct, pct > 0 ? 1.5 : 0)}%` }} />
      </div>
    </div>
  );
}
