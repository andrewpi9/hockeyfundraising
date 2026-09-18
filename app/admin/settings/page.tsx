import { adminPage } from "@/lib/page-guards";
import { AdminShell } from "@/components/admin/AdminShell";
import { OrgForm } from "@/components/admin/OrgForm";
import { card } from "@/components/ui";
import { orgPostalAddress } from "@/lib/outreach";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const { org } = await adminPage();
  const ready = Boolean(orgPostalAddress(org));
  return (
    <AdminShell orgName={org.name} title="Organization settings">
      {!ready ? (
        <p role="status" className="mb-6 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          Participants can&rsquo;t send email until a mailing address is saved here.
        </p>
      ) : null}
      <div className={`${card} max-w-2xl p-6`}>
        <OrgForm
          defaults={{
            name: org.name,
            legalName: org.legalName ?? "",
            ein: org.ein ?? "",
            addressLine1: org.addressLine1 ?? "",
            addressLine2: org.addressLine2 ?? "",
            city: org.city ?? "",
            state: org.state ?? "",
            postalCode: org.postalCode ?? "",
          }}
        />
      </div>
    </AdminShell>
  );
}
