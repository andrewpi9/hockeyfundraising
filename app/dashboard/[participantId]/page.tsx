import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteHeader, SiteFooter } from "@/components/SiteChrome";
import { LiveStats } from "@/components/LiveStats";
import { Supporters } from "@/components/participant/Supporters";
import { ProfileForm, PhotoUploader } from "@/components/participant/ProfileForm";
import { ShareCard } from "@/components/participant/ShareCard";
import { Contacts } from "@/components/participant/Contacts";
import { Stat, card, buttonStyles } from "@/components/ui";
import { participantOwnerPage } from "@/lib/page-guards";
import { getParticipantConsole } from "@/lib/queries/participants";
import { ensurePersonalShareLink } from "@/lib/sharing";
import { siteUrl } from "@/lib/site";

export const dynamic = "force-dynamic";

export default async function ParticipantConsole({ params }: { params: Promise<{ participantId: string }> }) {
  const { participantId } = await params;
  await participantOwnerPage(participantId);

  const data = await getParticipantConsole(participantId);
  if (!data) notFound();
  const { participant, campaign, raisedCents, donorCount, clickCount } = data;
  const shareCode = data.shareCode ?? (await ensurePersonalShareLink(participant.id, campaign.id));
  const shareUrl = siteUrl(`/r/${shareCode}`);

  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-3xl flex-1 space-y-8 px-4 py-8">
        <header>
          <p className="text-sm text-muted">
            <Link href="/dashboard" className="hover:underline">Dashboard</Link> / {campaign.name}
          </p>
          <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
            <h1 className="font-display text-3xl font-bold uppercase">
              Hi, {participant.displayName.split(" ")[0]}
              {participant.rosterNumber ? <span className="ml-2 text-carolina-500">#{participant.rosterNumber}</span> : null}
            </h1>
            {campaign.status !== "draft" ? (
              <Link href={`/c/${campaign.slug}/${participant.slug}`} className={buttonStyles.ghost}>View my public page &rarr;</Link>
            ) : (
              <span className="text-sm text-muted">Your page goes live when the campaign launches.</span>
            )}
          </div>
          <div className={`${card} mt-4 p-5`}>
            <LiveStats endpoint={`/api/participants/${participant.id}/stats`} goalCents={participant.goalCents} initial={{ raisedCents, donorCount }} />
          </div>
          <div className="mt-3 grid grid-cols-3 gap-3">
            <Stat label="Donors" value={donorCount} />
            <Stat label="Link clicks" value={clickCount} />
            <Stat label="Campaign" value={campaign.status} />
          </div>
        </header>

        <section className={`${card} p-5`}>
          <h2 className="text-lg font-bold">Your link</h2>
          <p className="mb-4 mt-1 text-sm text-muted">
            Post it anywhere — a story, a group chat, an email signature. The QR code works on a poster or a locker-room whiteboard.
            Every click is tracked back to you.
          </p>
          <ShareCard url={shareUrl} code={shareCode} />
        </section>

        <Supporters participantId={participant.id} />

        <Contacts participantId={participant.id} campaignActive={campaign.status === "active"} />

        <section className={`${card} p-5`}>
          <h2 className="mb-4 text-lg font-bold">Your page</h2>
          <div className="grid gap-6 sm:grid-cols-[160px_1fr]">
            <PhotoUploader participantId={participant.id} photoUrl={participant.photoUrl} name={participant.displayName} />
            <ProfileForm
              participantId={participant.id}
              defaults={{
                displayName: participant.displayName,
                bio: participant.bio ?? "",
                goal: participant.goalCents ? String(participant.goalCents / 100) : "",
                teamRole: participant.teamRole ?? "",
                rosterNumber: participant.rosterNumber ?? "",
                classYear: participant.classYear ?? "",
              }}
            />
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
