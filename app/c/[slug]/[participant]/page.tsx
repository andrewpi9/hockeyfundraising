import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteHeader, SiteFooter } from "@/components/SiteChrome";
import { LiveStats } from "@/components/LiveStats";
import { FeeDisclosure } from "@/components/FeeDisclosure";
import { DonateForm } from "@/components/DonateForm";
import { DonorWall } from "@/components/DonorWall";
import { Avatar, card } from "@/components/ui";
import { brand, classYearLabel } from "@/lib/brand";
import { getOrg, getPublicCampaignBySlug } from "@/lib/queries/campaigns";
import { getParticipantPublic } from "@/lib/queries/participants";
import { listPublicDonations } from "@/lib/queries/donations";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string; participant: string }>; searchParams: Promise<{ ref?: string }> };

async function load(slug: string, participantSlug: string) {
  const org = await getOrg();
  if (!org) return null;
  const campaign = await getPublicCampaignBySlug(org.id, slug);
  if (!campaign) return null;
  const row = await getParticipantPublic(campaign.id, participantSlug);
  if (!row) return null;
  return { org, campaign, ...row };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug, participant } = await params;
  const data = await load(slug, participant);
  if (!data) return {};
  // This is the card that renders when the link lands in a text thread.
  const title = `Help ${data.participant.displayName} — ${data.campaign.name}`;
  return {
    title,
    description: data.participant.bio?.slice(0, 160) ?? data.campaign.description?.slice(0, 160) ?? undefined,
    openGraph: { title, images: data.participant.photoUrl ? [data.participant.photoUrl] : [brand.logo] },
  };
}

export default async function ParticipantPage({ params, searchParams }: Props) {
  const { slug, participant: participantSlug } = await params;
  const { ref } = await searchParams;
  const data = await load(slug, participantSlug);
  if (!data) notFound();
  const { org, campaign, participant, raisedCents, donorCount } = data;
  const wall = await listPublicDonations(campaign.id, { participantId: participant.id, limit: 15 });
  const subtitle = [participant.teamRole, classYearLabel(participant.classYear)].filter(Boolean).join(" · ");

  return (
    <>
      <SiteHeader />
      <main className="flex-1">
        <section className="ice-hero text-white">
          <div className="mx-auto max-w-5xl px-4 py-10 sm:py-14">
            <Link href={`/c/${campaign.slug}`} className="text-sm text-carolina-300 underline-offset-4 hover:underline">
              &larr; {campaign.name}
            </Link>

            <div className="mt-6 flex flex-wrap items-center gap-6">
              <Avatar src={participant.photoUrl} name={participant.displayName} size={144} className="ring-4 ring-carolina-400 shadow-2xl shadow-navy-950/50" />
              <div className="min-w-0 flex-1">
                <p className="font-display text-sm font-semibold uppercase tracking-[0.3em] text-carolina-300">{brand.name}</p>
                <h1 className="mt-1 font-display text-5xl font-bold uppercase leading-[0.95] sm:text-6xl">{participant.displayName}</h1>
                {subtitle ? <p className="mt-2 text-lg text-carolina-100">{subtitle}</p> : null}
              </div>
              {participant.rosterNumber ? (
                <div className="hidden select-none font-display text-[8rem] font-bold leading-none text-carolina-400/35 sm:block lg:text-[10rem]" aria-label={`Number ${participant.rosterNumber}`}>
                  #{participant.rosterNumber}
                </div>
              ) : null}
            </div>

            <div className="mt-8 max-w-xl rounded-2xl border border-white/10 bg-white/10 p-5 backdrop-blur">
              <LiveStats endpoint={`/api/participants/${participant.id}/stats`} goalCents={participant.goalCents} initial={{ raisedCents, donorCount }} tone="dark" />
            </div>
          </div>
        </section>

        <div className="mx-auto grid max-w-5xl gap-8 px-4 py-10 lg:grid-cols-[1fr_360px] lg:items-start">
          <div className="space-y-10">
            {participant.bio ? (
              <section className={`${card} p-6`}>
                <h2 className="font-display text-2xl font-bold uppercase">From {participant.displayName.split(" ")[0]}</h2>
                <div className="mt-3 space-y-3 leading-relaxed text-muted">
                  {participant.bio.split("\n\n").map((para, i) => (
                    <p key={i}>{para}</p>
                  ))}
                </div>
              </section>
            ) : null}
            <section>
              <h2 className="mb-3 font-display text-2xl font-bold uppercase">Supporters</h2>
              <DonorWall donations={wall} />
            </section>
          </div>
          <aside id="donate" className="scroll-mt-24 space-y-4 lg:sticky lg:top-24">
            {campaign.status === "active" ? (
              <DonateForm
                campaignSlug={campaign.slug}
                participantSlug={participant.slug}
                participantName={participant.displayName}
                refCode={ref}
                allowFeeCover={campaign.allowFeeCover}
                platformFeeBps={campaign.platformFeeBps}
                turnstileSiteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || undefined}
              />
            ) : null}
            <FeeDisclosure platformFeeBps={campaign.platformFeeBps} allowFeeCover={campaign.allowFeeCover} />
          </aside>
        </div>
      </main>
      <SiteFooter org={{ legalName: org.legalName, ein: org.ein }} />
    </>
  );
}
