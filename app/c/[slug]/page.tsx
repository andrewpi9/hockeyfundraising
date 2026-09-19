import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteHeader, SiteFooter } from "@/components/SiteChrome";
import { LiveStats } from "@/components/LiveStats";
import { Leaderboard } from "@/components/Leaderboard";
import { FeeDisclosure } from "@/components/FeeDisclosure";
import { DonateForm } from "@/components/DonateForm";
import { DonorWall } from "@/components/DonorWall";
import { buttonStyles, card } from "@/components/ui";
import { brand } from "@/lib/brand";
import { getOrg, getPublicCampaignBySlug } from "@/lib/queries/campaigns";
import { listParticipantsWithTotals } from "@/lib/queries/participants";
import { listPublicDonations } from "@/lib/queries/donations";
import { paymentsConfigured, paymentsInTestMode } from "@/lib/stripe";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const org = await getOrg();
  const campaign = org ? await getPublicCampaignBySlug(org.id, slug) : null;
  if (!campaign) return {};
  return { title: campaign.name, description: campaign.description?.slice(0, 160) ?? undefined };
}

export default async function CampaignPage({ params }: Props) {
  const { slug } = await params;
  const org = await getOrg();
  if (!org) notFound();
  const campaign = await getPublicCampaignBySlug(org.id, slug);
  if (!campaign) notFound();

  const [leaderboard, wall] = await Promise.all([listParticipantsWithTotals(campaign.id), listPublicDonations(campaign.id, { limit: 15 })]);
  // Server component on a force-dynamic route: evaluated once per request, so
  // there is no re-render for the clock to drift across.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  const daysLeft = campaign.endsAt ? Math.max(0, Math.ceil((campaign.endsAt.getTime() - now) / 86_400_000)) : null;

  return (
    <>
      <SiteHeader />
      <main className="flex-1">
        <section className="ice-hero text-white">
          <div className="mx-auto grid max-w-5xl gap-8 px-4 py-12 sm:py-16 lg:grid-cols-[1fr_auto] lg:items-center">
            <div>
              <p className="font-display text-sm font-semibold uppercase tracking-[0.3em] text-carolina-300">{brand.tagline}</p>
              <h1 className="mt-2 max-w-2xl font-display text-5xl font-bold uppercase leading-[0.95] sm:text-7xl">{campaign.name}</h1>
              {campaign.status === "closed" ? <p className="mt-3 inline-block rounded-full bg-white/15 px-3 py-1 text-sm">This campaign has ended.</p> : null}

              <div className="mt-8 max-w-xl rounded-2xl border border-white/10 bg-white/10 p-5 backdrop-blur">
                <LiveStats endpoint={`/api/campaigns/${campaign.id}/stats`} goalCents={campaign.goalCents} initial={{ raisedCents: campaign.raisedCents, donorCount: campaign.donorCount }} tone="dark" />
                <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm text-carolina-100">
                  <span>
                    <strong className="tabular-nums">{campaign.participantCount}</strong> players
                  </span>
                  {daysLeft !== null && campaign.status === "active" ? (
                    <span>
                      <strong className="tabular-nums">{daysLeft}</strong> {daysLeft === 1 ? "day" : "days"} left
                    </span>
                  ) : null}
                </div>
              </div>

              {campaign.status === "active" ? (
                <div className="mt-6 flex flex-wrap gap-3">
                  <Link href="#donate" className={buttonStyles.hero}>
                    Donate
                  </Link>
                  <Link href="#participants" className={buttonStyles.heroOutline}>
                    Find a player
                  </Link>
                </div>
              ) : null}
            </div>
            <Image src={brand.logo} alt={brand.name} width={260} height={204} priority className="hidden w-56 drop-shadow-[0_12px_32px_rgba(75,156,211,0.4)] lg:block xl:w-64" />
          </div>
        </section>

        <div className="mx-auto grid max-w-5xl gap-8 px-4 py-10 lg:grid-cols-[1fr_360px] lg:items-start">
          <div className="space-y-10">
            {campaign.description ? (
              <section className={`${card} p-6`}>
                <h2 className="font-display text-2xl font-bold uppercase">About this campaign</h2>
                <div className="mt-3 space-y-3 leading-relaxed text-muted">
                  {campaign.description.split("\n\n").map((para, i) => (
                    <p key={i}>{para}</p>
                  ))}
                </div>
              </section>
            ) : null}
            <section id="participants" className="scroll-mt-24">
              <h2 className="mb-3 font-display text-2xl font-bold uppercase">Roster</h2>
              <Leaderboard rows={leaderboard} campaignSlug={campaign.slug} />
            </section>
            <section>
              <h2 className="mb-3 font-display text-2xl font-bold uppercase">Recent supporters</h2>
              <DonorWall donations={wall} showParticipant campaignSlug={campaign.slug} />
            </section>
          </div>
          <aside id="donate" className="scroll-mt-24 space-y-4 lg:sticky lg:top-24">
            {campaign.status === "active" ? (
              <DonateForm campaignSlug={campaign.slug} allowFeeCover={campaign.allowFeeCover} platformFeeBps={campaign.platformFeeBps} turnstileSiteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || undefined}
                paymentsEnabled={paymentsConfigured()}
                testMode={paymentsInTestMode()} />
            ) : null}
            <FeeDisclosure platformFeeBps={campaign.platformFeeBps} allowFeeCover={campaign.allowFeeCover} />
          </aside>
        </div>
      </main>
      <SiteFooter org={{ legalName: org.legalName, ein: org.ein, address: [org.addressLine1, org.city, org.state, org.postalCode].filter(Boolean).join(", ") || null }} />
    </>
  );
}
