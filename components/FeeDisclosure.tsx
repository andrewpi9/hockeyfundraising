import { stripeFeeRate, formatMoney } from "@/lib/money";
import { card } from "./ui";

/**
 * The transparent-fee requirement, rendered on every public campaign page and
 * above the donate form. Nothing is hidden and there is no tip prompt.
 */
export function FeeDisclosure({ platformFeeBps, allowFeeCover }: { platformFeeBps: number; allowFeeCover: boolean }) {
  const platformPct = (platformFeeBps / 100).toFixed(platformFeeBps % 100 === 0 ? 0 : 2);
  const { percent, fixedCents } = stripeFeeRate();
  return (
    <div className={`${card} p-4 text-sm`}>
      <h3 className="font-semibold">Where your money goes</h3>
      <dl className="mt-2 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1">
        <dt className="text-muted">Platform fee</dt>
        <dd className="text-right font-semibold tabular-nums">{platformPct}%</dd>
        <dt className="text-muted">Card processing (Stripe)</dt>
        <dd className="text-right tabular-nums">
          {(percent * 100).toFixed(1)}% + {formatMoney(fixedCents)}
        </dd>
      </dl>
      <p className="mt-3 text-muted">
        Donations settle directly to the organization&rsquo;s own Stripe account. This site never
        holds the money.
        {allowFeeCover
          ? " At checkout you can choose to add the card processing cost so the full amount reaches the program; that box is pre-checked and you can uncheck it."
          : ""}
      </p>
    </div>
  );
}
