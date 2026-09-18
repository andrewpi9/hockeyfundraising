import { adminPage } from "@/lib/page-guards";
import { createCampaign } from "@/app/admin/actions";
import { AdminShell } from "@/components/admin/AdminShell";
import { CampaignForm } from "@/components/admin/CampaignForm";
import { card } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function NewCampaignPage() {
  const { org } = await adminPage();
  return (
    <AdminShell orgName={org.name} title="New campaign">
      <div className={`${card} max-w-2xl p-6`}>
        <p className="mb-5 text-sm text-muted">
          The campaign starts as a draft — invisible to the public until you launch it. You&rsquo;ll get
          a join code for participants and a public URL.
        </p>
        <CampaignForm action={createCampaign} submitLabel="Create draft" />
      </div>
    </AdminShell>
  );
}
