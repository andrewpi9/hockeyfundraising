import Link from "next/link";
import { SiteHeader, SiteFooter } from "@/components/SiteChrome";
import { Thermometer } from "@/components/Thermometer";
import { card } from "@/components/ui";
import { getOrg, listPublicCampaigns } from "@/lib/queries/campaigns";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const org = await getOrg();
  if (!org) {
    return (
      <main className="mx-auto w-full max-w-xl flex-1 px-4 py-24 text-center">
        <h1 className="text-2xl font-bold">Not set up yet</h1>
        <p className="mt-2 text-muted">
          Run <code className="font-mono text-sm">npm run db:seed</code> to create the organization.
        </p>
      </main>
    );
  }

  const campaigns = await listPublicCampaigns(org.id);
  const active = campaigns.filter((c) => c.status === "active");
  const closed = campaigns.filter((c) => c.status === "closed");

  return (
    <>
      <SiteHeader orgName={org.name} />
      <main className="flex-1">
        <section className="border-b border-border bg-navy-900 text-white">
          <div className="mx-auto max-w-5xl px-4 py-14">
            <h1 className="text-3xl font-bold sm:text-5xl">{org.name}</h1>
            <p className="mt-4 max-w-xl text-carolina-100">
              Every campaign here runs with a 0% platform fee. What you give goes to the program,
              minus only the card processor&rsquo;s cost — which you can choose to cover.
            </p>
          </div>
        </section>

        <div className="mx-auto max-w-5xl space-y-10 px-4 py-10">
          <section>
            <h2 className="mb-3 text-lg font-bold">Active campaigns</h2>
            {active.length === 0 ? (
              <p className="text-muted">No campaigns are accepting donations right now.</p>
            ) : (
              <ul className="grid gap-4 sm:grid-cols-2">
                {active.map((c) => (
                  <li key={c.id}>
                    <Link href={`/c/${c.slug}`} className={`${card} block p-5 transition hover:border-carolina-300 hover:shadow-md`}>
                      <h3 className="text-lg font-bold">{c.name}</h3>
                      <div className="mt-3">
                        <Thermometer raisedCents={c.raisedCents} goalCents={c.goalCents} size="sm" />
                      </div>
                      <p className="mt-2 text-sm text-muted">
                        {c.participantCount} {c.participantCount === 1 ? "participant" : "participants"} · {c.donorCount}{" "}
                        {c.donorCount === 1 ? "donor" : "donors"}
                      </p>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {closed.length > 0 ? (
            <section>
              <h2 className="mb-3 text-lg font-bold text-muted">Past campaigns</h2>
              <ul className="space-y-2">
                {closed.map((c) => (
                  <li key={c.id}>
                    <Link href={`/c/${c.slug}`} className="text-sm underline-offset-4 hover:underline">
                      {c.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      </main>
      <SiteFooter org={{ legalName: org.legalName, ein: org.ein, address: [org.addressLine1, org.city, org.state, org.postalCode].filter(Boolean).join(", ") || null }} />
    </>
  );
}
