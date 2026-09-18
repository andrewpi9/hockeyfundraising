import Link from "next/link";
import { notFound } from "next/navigation";
import { adminPage } from "@/lib/page-guards";
import { updateCampaign } from "@/app/admin/actions";
import { getCampaignWithTotals } from "@/lib/queries/campaigns";
import { AdminShell, StatusBadge } from "@/components/admin/AdminShell";
import { CampaignForm } from "@/components/admin/CampaignForm";
import { StatusControls, JoinCodeCard } from "@/components/admin/StatusControls";
import { Roster } from "@/components/admin/Roster";
import { LiveStats } from "@/components/LiveStats";
import { Financials } from "@/components/admin/Financials";
import { RecentDonations } from "@/components/admin/RecentDonations";
import { card, buttonStyles } from "@/components/ui";
import { getCampaignFinancials } from "@/lib/queries/admin-donations";
import { toDateInput } from "@/lib/actions";
import { siteUrl } from "@/lib/site";

export const dynamic = "force-dynamic";

export default async function CampaignAdminPage({ params }: { params: Promise<{ id: string }> }) {
  const { org, user } = await adminPage();
  const { id } = await params;

  // adminPage proves org membership; this proves the campaign is in THAT org.
  const campaign = await getCampaignWithTotals(id);
  if (!campaign || campaign.orgId !== org.id) notFound();

  const publicUrl = siteUrl(`/c/${campaign.slug}`);
  const financials = await getCampaignFinancials(campaign.id);

  return (
    <AdminShell
      orgName={org.name}
      title={campaign.name}
      actions={
        <div className="flex items-center gap-3">
          <StatusBadge status={campaign.status} />
          {campaign.status !== "draft" ? (
            <Link href={`/c/${campaign.slug}`} className="text-sm underline-offset-4 hover:underline">
              View public page &rarr;
            </Link>
          ) : null}
        </div>
      }
    >
      <div className="grid gap-6 lg:grid-cols-[1fr_340px] lg:items-start">
        <div className="space-y-6">
          <section className={`${card} p-5`}>
            <LiveStats
              endpoint={`/api/campaigns/${campaign.id}/stats`}
              goalCents={campaign.goalCents}
              initial={{ raisedCents: campaign.raisedCents, donorCount: campaign.donorCount }}
            />
          </section>

          <Financials f={financials} />

          <section>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-bold">Donations</h2>
              <a href={`/api/admin/campaigns/${campaign.id}/export`} className={buttonStyles.outline} download>
                Export CSV
              </a>
            </div>
            <RecentDonations campaignId={campaign.id} orgId={org.id} actorUserId={user.id} />
            <p className="mt-2 text-xs text-muted">Viewing or exporting donor details is recorded in the audit log.</p>
          </section>

          <section className={`${card} p-5`}>
            <h2 className="mb-4 text-lg font-bold">Details</h2>
            <CampaignForm
              action={updateCampaign}
              campaignId={campaign.id}
              submitLabel="Save changes"
              defaults={{
                name: campaign.name,
                description: campaign.description ?? "",
                goal: campaign.goalCents ? String(campaign.goalCents / 100) : "",
                startsAt: toDateInput(campaign.startsAt),
                endsAt: toDateInput(campaign.endsAt),
                allowFeeCover: campaign.allowFeeCover,
              }}
            />
          </section>

          <section>
            <h2 className="mb-3 text-lg font-bold">Roster</h2>
            <Roster campaignId={campaign.id} campaignSlug={campaign.slug} />
          </section>
        </div>

        <aside className="space-y-6">
          <section className={`${card} p-5`}>
            <h2 className="mb-3 text-lg font-bold">Status</h2>
            <StatusControls campaignId={campaign.id} status={campaign.status} />
          </section>

          <section className={`${card} p-5`}>
            <h2 className="mb-3 text-lg font-bold">Join code</h2>
            <JoinCodeCard campaignId={campaign.id} code={campaign.joinCode} />
          </section>

          <section className={`${card} p-5`}>
            <h2 className="mb-2 text-lg font-bold">Public link</h2>
            <code className="block break-all rounded-xl border border-border bg-bg px-3 py-2 font-mono text-sm">{publicUrl}</code>
            {campaign.status === "draft" ? (
              <p className="mt-2 text-sm text-muted">Returns 404 until the campaign is launched.</p>
            ) : null}
          </section>
        </aside>
      </div>
    </AdminShell>
  );
}
