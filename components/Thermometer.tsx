import { formatMoneyShort } from "@/lib/money";

export function Thermometer({
  raisedCents,
  goalCents,
  size = "lg",
}: {
  raisedCents: number;
  goalCents: number;
  size?: "sm" | "lg";
}) {
  const pct = goalCents > 0 ? Math.min(100, (raisedCents / goalCents) * 100) : 0;
  const large = size === "lg";

  return (
    <div>
      <div className="flex items-end justify-between gap-3">
        <div>
          <span
            className={`font-bold tabular-nums ${large ? "text-4xl sm:text-5xl" : "text-xl"}`}
          >
            {formatMoneyShort(raisedCents)}
          </span>
          {goalCents > 0 ? (
            <span className={`text-muted ${large ? "text-lg" : "text-sm"}`}>
              {" "}
              of {formatMoneyShort(goalCents)}
            </span>
          ) : null}
        </div>
        {goalCents > 0 ? (
          <span
            className={`font-semibold tabular-nums text-carolina-600 dark:text-carolina-300 ${large ? "text-lg" : "text-sm"}`}
          >
            {Math.round(pct)}%
          </span>
        ) : null}
      </div>

      <div
        className={`mt-2 overflow-hidden rounded-full bg-carolina-100 dark:bg-navy-800 ${large ? "h-3.5" : "h-2"}`}
        role="progressbar"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${formatMoneyShort(raisedCents)} raised of ${formatMoneyShort(goalCents)} goal`}
      >
        <div
          className="animate-fill h-full rounded-full bg-gradient-to-r from-carolina-500 to-carolina-300"
          style={{ width: `${Math.max(pct, pct > 0 ? 1.5 : 0)}%` }}
        />
      </div>
    </div>
  );
}
