import Link from "next/link";
import { SiteHeader, SiteFooter } from "@/components/SiteChrome";
import { Thermometer } from "@/components/Thermometer";
import { DonateForm } from "@/components/DonateForm";
import { Leaderboard } from "@/components/Leaderboard";
import { DonorWall } from "@/components/DonorWall";
import { card, buttonStyles } from "@/components/ui";
import {
  getActiveCampaign,
  getCampaignTotals,
  getLeaderboard,
  getRecentDonations,
} from "@/lib/queries";

// Totals must be live the moment a gift lands, so nothing here is cached.
export const dynamic = "force-dynamic";

export default async function HomePage() {
  const campaign = await getActiveCampaign();

  if (!campaign) {
    return (
      <>
        <SiteHeader />
        <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-20 text-center">
          <h1 className="text-2xl font-bold">No active fundraiser</h1>
          <p className="mt-2 text-muted">
            Run <code className="font-mono text-sm">npm run db:seed</code> to
            create one, or start a new campaign from the dashboard.
          </p>
        </main>
        <SiteFooter />
      </>
    );
  }

  const [totals, leaderboard, donations] = await Promise.all([
    getCampaignTotals(campaign.id),
    getLeaderboard(campaign.id),
    getRecentDonations(campaign.id, { limit: 12 }),
  ]);

  // Evaluated once per request: this is a server component and the route is
  // force-dynamic, so there is no re-render for the clock to drift across.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  const daysLeft = campaign.endsAt
    ? Math.max(0, Math.ceil((campaign.endsAt.getTime() - now) / 86_400_000))
    : null;

  return (
    <>
      <SiteHeader />

      <main className="flex-1">
        <section className="border-b border-border bg-navy-900 text-white">
          <div className="mx-auto max-w-5xl px-4 py-12 sm:py-16">
            <p className="text-sm font-semibold uppercase tracking-widest text-carolina-300">
              {campaign.tagline ?? "Support the team"}
            </p>
            <h1 className="mt-2 max-w-2xl text-3xl font-bold leading-tight sm:text-5xl">
              {campaign.name}
            </h1>

            <div className="mt-8 max-w-xl rounded-2xl bg-white/10 p-5 backdrop-blur">
              <Thermometer
                raisedCents={totals.raisedCents}
                goalCents={campaign.goalCents}
              />
              <div className="mt-4 flex flex-wrap gap-x-6 gap-y-1 text-sm text-carolina-100">
                <span>
                  <strong className="tabular-nums">{totals.donorCount}</strong>{" "}
                  {totals.donorCount === 1 ? "donor" : "donors"}
                </span>
                <span>
                  <strong className="tabular-nums">{leaderboard.length}</strong>{" "}
                  players
                </span>
                {daysLeft !== null ? (
                  <span>
                    <strong className="tabular-nums">{daysLeft}</strong>{" "}
                    {daysLeft === 1 ? "day" : "days"} left
                  </span>
                ) : null}
              </div>
            </div>

            <div className="mt-6 flex flex-wrap gap-3">
              <Link href="#donate" className={buttonStyles.primary}>
                Donate now
              </Link>
              <Link
                href="#players"
                className="inline-flex items-center rounded-xl border border-white/25 px-5 py-2.5 font-semibold transition hover:bg-white/10"
              >
                Find a player
              </Link>
            </div>

            <p className="mt-6 max-w-lg text-sm text-carolina-200">
              No platform fee. No suggested tip. Unlike commercial fundraising
              sites that keep 20%, every dollar here goes to the team.
            </p>
          </div>
        </section>

        <div className="mx-auto grid max-w-5xl gap-8 px-4 py-10 lg:grid-cols-[1fr_380px] lg:items-start">
          <div className="space-y-10">
            {campaign.story ? (
              <section className={`${card} p-6`}>
                <h2 className="text-lg font-bold">Where your money goes</h2>
                <div className="mt-3 space-y-3 leading-relaxed text-muted">
                  {campaign.story.split("\n\n").map((para, i) => (
                    <p key={i}>{para}</p>
                  ))}
                </div>
              </section>
            ) : null}

            <section id="players" className="scroll-mt-20">
              <h2 className="mb-3 text-lg font-bold">Team leaderboard</h2>
              <Leaderboard rows={leaderboard} />
            </section>

            <section>
              <h2 className="mb-3 text-lg font-bold">Recent supporters</h2>
              <DonorWall donations={donations} showPlayer />
            </section>
          </div>

          <aside id="donate" className="scroll-mt-20 lg:sticky lg:top-20">
            <DonateForm />
          </aside>
        </div>
      </main>

      <SiteFooter />
    </>
  );
}
