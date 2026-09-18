import Link from "next/link";
import { redirect } from "next/navigation";
import { SiteHeader, SiteFooter } from "@/components/SiteChrome";
import { Thermometer } from "@/components/Thermometer";
import { DonorWall } from "@/components/DonorWall";
import { AddPlayerForm, CampaignForm } from "@/components/AdminForms";
import { Stat, card, buttonStyles } from "@/components/ui";
import { getSession } from "@/lib/auth";
import { formatMoney, formatMoneyShort, estimatedStripeFee } from "@/lib/money";
import {
  getActiveCampaign,
  getCampaignTotals,
  getRosterWithActivity,
  getRecentDonations,
  getUnattributedTotal,
} from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "admin") redirect("/me");

  const campaign = await getActiveCampaign();
  if (!campaign) {
    return (
      <>
        <SiteHeader />
        <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-20 text-center">
          <h1 className="text-xl font-bold">No active campaign</h1>
          <p className="mt-2 text-muted">
            Run <code className="font-mono text-sm">npm run db:seed</code> to create one.
          </p>
        </main>
        <SiteFooter />
      </>
    );
  }

  const [totals, roster, donations, unattributed] = await Promise.all([
    getCampaignTotals(campaign.id),
    getRosterWithActivity(campaign.id),
    getRecentDonations(campaign.id, { limit: 15 }),
    getUnattributedTotal(campaign.id),
  ]);

  const grossCents = totals.raisedCents + totals.feesCoveredCents;
  // Rough: Stripe's cut is per charge, so this approximates using the average.
  const estFees =
    totals.donationCount > 0
      ? estimatedStripeFee(Math.round(grossCents / totals.donationCount)) *
        totals.donationCount
      : 0;
  const netCents = grossCents - estFees;
  const wouldHaveLost = Math.round(totals.raisedCents * 0.2);

  return (
    <>
      <SiteHeader />

      <main className="mx-auto w-full max-w-4xl flex-1 space-y-8 px-4 py-8">
        <header>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h1 className="text-2xl font-bold">{campaign.name}</h1>
            <a href="/api/export/donors" className={buttonStyles.outline} download>
              Export donors (CSV)
            </a>
          </div>

          <div className={`${card} mt-4 p-5`}>
            <Thermometer
              raisedCents={totals.raisedCents}
              goalCents={campaign.goalCents}
            />
          </div>

          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Donations" value={totals.donationCount} />
            <Stat label="Donors" value={totals.donorCount} />
            <Stat
              label="Fees covered"
              value={formatMoneyShort(totals.feesCoveredCents)}
              sub="paid by donors"
            />
            <Stat
              label="Est. net to bank"
              value={formatMoneyShort(netCents)}
              sub={`after ~${formatMoney(estFees)} Stripe`}
            />
          </div>

          <p className="mt-3 rounded-xl bg-carolina-50 px-4 py-3 text-sm dark:bg-navy-800">
            A 20%-fee platform would have taken{" "}
            <strong>{formatMoney(wouldHaveLost)}</strong> of this. You paid about{" "}
            <strong>{formatMoney(estFees)}</strong> in card processing instead.
          </p>
        </header>

        <section>
          <h2 className="mb-3 text-lg font-bold">Roster</h2>
          <div className={`${card} overflow-x-auto`}>
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                  <th className="px-4 py-3 font-medium">Player</th>
                  <th className="px-4 py-3 text-right font-medium">Raised</th>
                  <th className="px-4 py-3 text-right font-medium">Goal</th>
                  <th className="px-4 py-3 text-right font-medium">Donors</th>
                  <th className="px-4 py-3 text-right font-medium">Contacts</th>
                  <th className="px-4 py-3 text-right font-medium">Sent</th>
                  <th className="px-4 py-3 text-right font-medium">Clicks</th>
                </tr>
              </thead>
              <tbody>
                {roster.map((p) => (
                  <tr key={p.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-3">
                      <Link
                        href={`/p/${p.slug}`}
                        className="font-medium underline-offset-2 hover:underline"
                      >
                        {p.displayName}
                      </Link>
                      <div className="text-xs text-muted">{p.email}</div>
                    </td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums">
                      {formatMoneyShort(p.raisedCents)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-muted">
                      {p.goalCents ? formatMoneyShort(p.goalCents) : "—"}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{p.donorCount}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{p.contactCount}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{p.sendCount}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{p.clickCount}</td>
                  </tr>
                ))}
                {roster.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-muted">
                      No players yet. Add one below.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>

          {unattributed > 0 ? (
            <p className="mt-2 text-sm text-muted">
              Plus {formatMoney(unattributed)} given straight through the team page,
              not credited to any player.
            </p>
          ) : null}

          <div className="mt-4 text-sm text-muted">
            <strong className="text-fg">Reading this table:</strong> contacts with
            zero sends is the number to chase. A player who has loaded contacts but
            not messaged them is one nudge away from their whole total.
          </div>
        </section>

        <section className={`${card} p-5`}>
          <h2 className="mb-4 text-lg font-bold">Add a player</h2>
          <AddPlayerForm />
        </section>

        <section className={`${card} p-5`}>
          <h2 className="mb-4 text-lg font-bold">Campaign settings</h2>
          <CampaignForm
            defaults={{
              name: campaign.name,
              tagline: campaign.tagline ?? "",
              story: campaign.story ?? "",
              goal: campaign.goalCents ? String(campaign.goalCents / 100) : "",
              endsAt: campaign.endsAt
                ? campaign.endsAt.toISOString().slice(0, 10)
                : "",
            }}
          />
        </section>

        <section>
          <h2 className="mb-3 text-lg font-bold">Recent donations</h2>
          <DonorWall donations={donations} showPlayer />
        </section>

        <form action="/api/auth/logout" method="post">
          <button type="submit" className={`${buttonStyles.ghost} text-muted`}>
            Sign out
          </button>
        </form>
      </main>

      <SiteFooter />
    </>
  );
}
