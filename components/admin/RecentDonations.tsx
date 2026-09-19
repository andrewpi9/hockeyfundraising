import { card } from "@/components/ui";
import { formatMoney } from "@/lib/money";
import { listDonationsForAdmin } from "@/lib/queries/admin-donations";
import { audit } from "@/lib/audit";
import { ReassignSelect } from "./RosterControls";

const STATUS_TONE: Record<string, string> = {
  succeeded: "text-emerald-700 dark:text-emerald-300",
  pending: "text-amber-700 dark:text-amber-300",
  refunded: "text-muted",
  partially_refunded: "text-muted",
  failed: "text-muted",
  disputed: "text-red-600",
};

/**
 * Renders donor names and emails to a campaign admin. That is a PII read, so
 * each render is audited with the row count — the agreed scope.
 */
export async function RecentDonations({ campaignId, orgId, actorUserId, roster }: { campaignId: string; orgId: string; actorUserId: string; roster: { id: string; displayName: string }[] }) {
  const rows = await listDonationsForAdmin(campaignId, 50);
  if (rows.length > 0) {
    await audit({ action: "donation.view_pii", targetType: "campaign", targetId: campaignId, orgId, actorUserId, metadata: { row_count: rows.length, view: "recent_donations" } });
  }

  if (rows.length === 0) return <p className="text-sm text-muted">No donations yet.</p>;

  return (
    <div className={`${card} overflow-x-auto`}>
      <table className="w-full min-w-[720px] text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
            <th className="px-4 py-3 font-medium">When</th>
            <th className="px-4 py-3 font-medium">Donor</th>
            <th className="px-4 py-3 text-right font-medium">Gift</th>
            <th className="px-4 py-3 text-right font-medium">Charged</th>
            <th className="px-4 py-3 font-medium">Status</th>
            <th className="px-4 py-3 font-medium">Credited to</th>
            <th className="px-4 py-3 font-medium">Via</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-border last:border-0">
              <td className="whitespace-nowrap px-4 py-2.5 text-muted">{r.createdAt.toLocaleDateString()} {r.createdAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</td>
              <td className="px-4 py-2.5">
                <div className="font-medium">{r.donorName ?? "—"}{r.isAnonymous ? <span className="ml-1.5 text-xs text-muted">(anonymous publicly)</span> : null}</div>
                <div className="text-xs text-muted">{r.donorEmail ?? "—"}</div>
                {r.message ? <div className="mt-0.5 text-xs italic text-muted">&ldquo;{r.message}&rdquo;</div> : null}
              </td>
              <td className="px-4 py-2.5 text-right font-semibold tabular-nums">{formatMoney(r.designatedCents)}</td>
              <td className="px-4 py-2.5 text-right tabular-nums text-muted">{formatMoney(r.grossCents)}{r.refundedCents ? <div className="text-xs">−{formatMoney(r.refundedCents)}</div> : null}</td>
              <td className={`px-4 py-2.5 text-xs font-semibold uppercase ${STATUS_TONE[r.status] ?? ""}`}>{r.status.replace("_", " ")}</td>
              <td className="px-4 py-2.5"><ReassignSelect donationId={r.id} current={r.participantId} roster={roster} /></td>
              <td className="px-4 py-2.5 text-xs text-muted">{r.source === "import" ? "imported" : (r.medium ?? "page")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
