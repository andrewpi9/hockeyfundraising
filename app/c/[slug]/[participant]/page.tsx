import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteHeader, SiteFooter } from "@/components/SiteChrome";
import { LiveStats } from "@/components/LiveStats";
import { FeeDisclosure } from "@/components/FeeDisclosure";
import { DonateForm } from "@/components/DonateForm";
import { DonorWall } from "@/components/DonorWall";
import { Avatar, card } from "@/components/ui";
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
    openGraph: { title, images: data.participant.photoUrl ? [data.participant.photoUrl] : undefined },
  };
}

export default async function ParticipantPage({ params, searchParams }: Props) {
  const { slug, participant: participantSlug } = await params;
  const { ref } = await searchParams;
  const data = await load(slug, participantSlug);
  if (!data) notFound();
  const { org, campaign, participant, raisedCents, donorCount } = data;
  const wall = await listPublicDonations(campaign.id, { participantId: participant.id, limit: 15 });

  return (
    <>
      <SiteHeader orgName={org.name} />
      <main className="flex-1">
        <section className="border-b border-border bg-navy-900 text-white">
          <div className="mx-auto max-w-5xl px-4 py-10 sm:py-14">
            <Link href={`/c/${campaign.slug}`} className="text-sm text-carolina-300 underline-offset-4 hover:underline">
              &larr; {campaign.name}
            </Link>
            <div className="mt-5 flex flex-wrap items-center gap-5">
              <Avatar src={participant.photoUrl} name={participant.displayName} size={96} />
              <div>
                <h1 className="text-3xl font-bold sm:text-4xl">{participant.displayName}</h1>
                <p className="mt-1 text-carolina-200">
                  {[participant.teamRole, participant.classYear ? `Class of ${participant.classYear}` : null].filter(Boolean).join(" · ")}
                </p>
              </div>
            </div>
            <div className="mt-8 max-w-xl rounded-2xl bg-white/10 p-5 backdrop-blur">
              <LiveStats endpoint={`/api/participants/${participant.id}/stats`} goalCents={participant.goalCents} initial={{ raisedCents, donorCount }} tone="dark" />
            </div>
          </div>
        </section>

        <div className="mx-auto grid max-w-5xl gap-8 px-4 py-10 lg:grid-cols-[1fr_360px] lg:items-start">
          <div className="space-y-10">
            {participant.bio ? (
              <section className={`${card} p-6`}>
                <h2 className="text-lg font-bold">From {participant.displayName.split(" ")[0]}</h2>
                <div className="mt-3 space-y-3 leading-relaxed text-muted">
                  {participant.bio.split("\n\n").map((para, i) => <p key={i}>{para}</p>)}
                </div>
              </section>
            ) : null}
            <section>
              <h2 className="mb-3 text-lg font-bold">Supporters</h2>
              <DonorWall donations={wall} />
            </section>
          </div>
          <aside id="donate" className="scroll-mt-20 space-y-4 lg:sticky lg:top-20">
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
