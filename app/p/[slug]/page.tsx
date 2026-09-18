import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { SiteHeader, SiteFooter } from "@/components/SiteChrome";
import { Thermometer } from "@/components/Thermometer";
import { DonateForm } from "@/components/DonateForm";
import { DonorWall } from "@/components/DonorWall";
import { Avatar, card } from "@/components/ui";
import {
  getActiveCampaign,
  getParticipantBySlug,
  getParticipantTotals,
  getRecentDonations,
} from "@/lib/queries";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ ref?: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const campaign = await getActiveCampaign();
  if (!campaign) return {};
  const participant = await getParticipantBySlug(campaign.id, slug);
  if (!participant) return {};

  // This is the card that renders when a player's link lands in a text thread,
  // so it names the player rather than the team.
  const title = `Help ${participant.displayName} — ${campaign.name}`;
  return {
    title,
    description: participant.bio ?? campaign.tagline ?? undefined,
    openGraph: {
      title,
      description: participant.bio ?? undefined,
      images: participant.photoUrl ? [participant.photoUrl] : undefined,
    },
  };
}

export default async function PlayerPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const { ref } = await searchParams;

  const campaign = await getActiveCampaign();
  if (!campaign) notFound();

  const participant = await getParticipantBySlug(campaign.id, slug);
  if (!participant) notFound();

  const [totals, donations] = await Promise.all([
    getParticipantTotals(participant.id),
    getRecentDonations(campaign.id, { participantId: participant.id, limit: 15 }),
  ]);

  return (
    <>
      <SiteHeader />

      <main className="flex-1">
        <section className="border-b border-border bg-navy-900 text-white">
          <div className="mx-auto max-w-5xl px-4 py-10 sm:py-14">
            <Link
              href="/"
              className="text-sm text-carolina-300 underline-offset-4 hover:underline"
            >
              &larr; {campaign.name}
            </Link>

            <div className="mt-5 flex flex-wrap items-center gap-5">
              <Avatar
                src={participant.photoUrl}
                name={participant.displayName}
                size={96}
              />
              <div>
                <h1 className="text-3xl font-bold sm:text-4xl">
                  {participant.displayName}
                </h1>
                <p className="mt-1 text-carolina-200">
                  {[
                    participant.jerseyNumber ? `#${participant.jerseyNumber}` : null,
                    participant.position,
                    participant.gradYear ? `Class of ${participant.gradYear}` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
            </div>

            <div className="mt-8 max-w-xl rounded-2xl bg-white/10 p-5 backdrop-blur">
              <Thermometer
                raisedCents={totals.raisedCents}
                goalCents={participant.goalCents}
              />
              <p className="mt-3 text-sm text-carolina-100">
                <strong className="tabular-nums">{totals.donorCount}</strong>{" "}
                {totals.donorCount === 1 ? "person has" : "people have"} chipped in
                so far
              </p>
            </div>
          </div>
        </section>

        <div className="mx-auto grid max-w-5xl gap-8 px-4 py-10 lg:grid-cols-[1fr_380px] lg:items-start">
          <div className="space-y-10">
            {participant.bio ? (
              <section className={`${card} p-6`}>
                <h2 className="text-lg font-bold">
                  From {participant.displayName.split(" ")[0]}
                </h2>
                <div className="mt-3 space-y-3 leading-relaxed text-muted">
                  {participant.bio.split("\n\n").map((para, i) => (
                    <p key={i}>{para}</p>
                  ))}
                </div>
              </section>
            ) : null}

            <section>
              <h2 className="mb-3 text-lg font-bold">Supporters</h2>
              <DonorWall donations={donations} />
            </section>
          </div>

          <aside className="lg:sticky lg:top-20">
            <DonateForm
              participantSlug={participant.slug}
              participantName={participant.displayName}
              refCode={ref}
            />
          </aside>
        </div>
      </main>

      <SiteFooter />
    </>
  );
}
