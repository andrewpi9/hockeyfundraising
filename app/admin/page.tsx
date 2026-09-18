import Link from "next/link";
import { adminPage } from "@/lib/page-guards";
import { listCampaignsForOrg } from "@/lib/queries/campaigns";
import { AdminShell, StatusBadge } from "@/components/admin/AdminShell";
import { Thermometer } from "@/components/Thermometer";
import { buttonStyles, card } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function AdminHome() {
  const { org } = await adminPage();
  const campaigns = await listCampaignsForOrg(org.id);

  return (
    <AdminShell
      orgName={org.name}
      title="Campaigns"
      actions={
        <Link href="/admin/campaigns/new" className={buttonStyles.primary}>
          New campaign
        </Link>
      }
    >
      {campaigns.length === 0 ? (
        <div className={`${card} p-8 text-center`}>
          <p className="text-muted">No campaigns yet. Create the first one to get a public page and a join code.</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {campaigns.map((c) => (
            <li key={c.id}>
              <Link href={`/admin/campaigns/${c.id}`} className={`${card} block p-5 transition hover:border-carolina-300 hover:shadow-md`}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 className="text-lg font-bold">{c.name}</h2>
                  <StatusBadge status={c.status} />
                </div>
                <div className="mt-3 max-w-md">
                  <Thermometer raisedCents={c.raisedCents} goalCents={c.goalCents} size="sm" />
                </div>
                <p className="mt-2 text-sm text-muted">
                  {c.participantCount} participants · {c.donorCount} donations · join code{" "}
                  <span className="font-mono font-semibold">{c.joinCode}</span>
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </AdminShell>
  );
}
