import { Stat, card } from "@/components/ui";
import { formatMoney, formatMoneyShort } from "@/lib/money";
import type { Financials as F } from "@/lib/queries/admin-donations";

export function Financials({ f }: { f: F }) {
  return (
    <section className="space-y-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Raised" value={formatMoneyShort(f.raisedCents)} sub={`${f.counts.succeeded} gifts`} />
        <Stat label="Fees covered by donors" value={formatMoneyShort(f.feeCoveredCents)} sub={`${Math.round(f.feeCoverRate * 100)}% opted in`} />
        <Stat label="Est. Stripe fees" value={formatMoney(f.estimatedStripeFeeCents)} sub="from configured rate" />
        <Stat label="Est. net to org" value={formatMoneyShort(f.estimatedNetCents)} sub="settles to the org's Stripe" />
      </div>
      {f.counts.pending + f.counts.refunded + f.counts.partially_refunded + f.counts.disputed + f.counts.failed > 0 ? (
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted">
          {f.counts.pending ? <span>{f.counts.pending} pending (bank transfers settling)</span> : null}
          {f.counts.refunded + f.counts.partially_refunded ? <span>{f.counts.refunded + f.counts.partially_refunded} refunded · {formatMoney(f.refundedCents)}</span> : null}
          {f.counts.disputed ? <span className="text-red-600">{f.counts.disputed} disputed</span> : null}
          {f.counts.failed ? <span>{f.counts.failed} failed/abandoned</span> : null}
        </div>
      ) : null}
      <p className={`${card} px-4 py-3 text-sm text-muted`}>
        Card processing on gifts taken through this site is estimated at <strong className="text-fg">{formatMoney(f.estimatedStripeFeeCents)}</strong>;
        donors chose to cover <strong className="text-fg">{formatMoney(f.feeCoveredCents)}</strong> of it.
        {f.importedCents > 0 ? ` ${formatMoney(f.importedCents)} was recorded from a previous campaign and is not included in that estimate.` : ""}
      </p>
    </section>
  );
}
