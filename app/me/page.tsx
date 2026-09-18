import { redirect } from "next/navigation";
import Link from "next/link";
import { and, desc, eq } from "drizzle-orm";
import { SiteHeader, SiteFooter } from "@/components/SiteChrome";
import { Thermometer } from "@/components/Thermometer";
import { DonorWall } from "@/components/DonorWall";
import { ShareTools, CopyLink } from "@/components/ShareTools";
import {
  ProfileForm,
  AddContactForm,
  ImportContactsForm,
} from "@/components/PlayerForms";
import { Stat, card, buttonStyles } from "@/components/ui";
import { db } from "@/lib/db";
import { contacts, shareLinks, participants } from "@/lib/db/schema";
import { getSession } from "@/lib/auth";
import {
  getActiveCampaign,
  getParticipantTotals,
  getParticipantActivity,
  getRecentDonations,
} from "@/lib/queries";
import { getOrCreateLink } from "./actions";
import { siteUrl } from "@/lib/stripe";

export const dynamic = "force-dynamic";

export default async function PlayerConsole() {
  const session = await getSession();
  if (!session) redirect("/login");

  const campaign = await getActiveCampaign();
  if (!campaign) {
    return (
      <>
        <SiteHeader />
        <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-20 text-center">
          <h1 className="text-xl font-bold">No active fundraiser</h1>
          <p className="mt-2 text-muted">Check back once your coach launches one.</p>
        </main>
        <SiteFooter />
      </>
    );
  }

  const [participant] = await db
    .select()
    .from(participants)
    .where(
      and(
        eq(participants.userId, session.userId),
        eq(participants.campaignId, campaign.id),
      ),
    )
    .limit(1);

  if (!participant) {
    return (
      <>
        <SiteHeader />
        <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-20 text-center">
          <h1 className="text-xl font-bold">You&rsquo;re not on this roster yet</h1>
          <p className="mt-2 text-muted">
            Ask your coach to add you to {campaign.name}.
          </p>
          {session.role === "admin" ? (
            <Link href="/dashboard" className={`${buttonStyles.primary} mt-6`}>
              Go to the dashboard
            </Link>
          ) : null}
        </main>
        <SiteFooter />
      </>
    );
  }

  const [totals, activity, donations, myContacts, genericCode] = await Promise.all([
    getParticipantTotals(participant.id),
    getParticipantActivity(participant.id),
    getRecentDonations(campaign.id, { participantId: participant.id, limit: 10 }),
    db
      .select({
        id: contacts.id,
        name: contacts.name,
        email: contacts.email,
        phone: contacts.phone,
        lastContactedAt: contacts.lastContactedAt,
        code: shareLinks.code,
      })
      .from(contacts)
      .leftJoin(shareLinks, eq(shareLinks.contactId, contacts.id))
      .where(eq(contacts.participantId, participant.id))
      .orderBy(desc(contacts.createdAt)),
    getOrCreateLink(participant.id, null, "social"),
  ]);

  const remaining = myContacts.filter((c) => !c.lastContactedAt).length;

  return (
    <>
      <SiteHeader />

      <main className="mx-auto w-full max-w-3xl flex-1 space-y-8 px-4 py-8">
        <header>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h1 className="text-2xl font-bold">Hi, {participant.displayName.split(" ")[0]}</h1>
            <Link href={`/p/${participant.slug}`} className={buttonStyles.ghost}>
              View my public page &rarr;
            </Link>
          </div>

          <div className={`${card} mt-4 p-5`}>
            <Thermometer
              raisedCents={totals.raisedCents}
              goalCents={participant.goalCents}
            />
          </div>

          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Donors" value={totals.donorCount} />
            <Stat label="Contacts" value={activity.contacts.total} />
            <Stat label="Messages sent" value={activity.sends} />
            <Stat label="Link clicks" value={activity.clicks} />
          </div>

          {remaining > 0 ? (
            <p className="mt-3 rounded-xl bg-carolina-50 px-4 py-3 text-sm dark:bg-navy-800">
              <strong>{remaining}</strong>{" "}
              {remaining === 1 ? "person hasn't" : "people haven't"} been messaged
              yet. Players who send 20+ messages raise roughly three times as much.
            </p>
          ) : null}
        </header>

        <section className={`${card} p-5`}>
          <h2 className="text-lg font-bold">Share your link</h2>
          <p className="mb-4 mt-1 text-sm text-muted">
            Post this anywhere — Instagram bio, GroupMe, a story. Clicks are
            tracked back to you.
          </p>
          <CopyLink url={siteUrl(`/r/${genericCode}`)} label="Your personal link" />
        </section>

        <section className={`${card} p-5`}>
          <h2 className="text-lg font-bold">Your contacts</h2>
          <p className="mb-4 mt-1 text-sm text-muted">
            Nobody is messaged automatically. Tapping Text or Email opens your own
            Messages or Mail app with the note already written, so it arrives from
            you — which is exactly why people open it.
          </p>

          <div className="space-y-6">
            <ImportContactsForm />
            <details className="rounded-xl border border-border p-4">
              <summary className="cursor-pointer text-sm font-medium">
                Add one at a time
              </summary>
              <div className="mt-4">
                <AddContactForm />
              </div>
            </details>
          </div>

          <div className="mt-6 border-t border-border pt-5">
            <ShareTools
              contacts={myContacts}
              playerName={participant.displayName}
              campaignName={campaign.name}
              baseUrl={siteUrl()}
            />
          </div>
        </section>

        <section className={`${card} p-5`}>
          <h2 className="mb-4 text-lg font-bold">Your page</h2>
          <ProfileForm
            defaults={{
              displayName: participant.displayName,
              bio: participant.bio ?? "",
              photoUrl: participant.photoUrl ?? "",
              goal: participant.goalCents ? String(participant.goalCents / 100) : "",
              jerseyNumber: participant.jerseyNumber ?? "",
              position: participant.position ?? "",
              gradYear: participant.gradYear ?? "",
            }}
          />
        </section>

        <section>
          <h2 className="mb-3 text-lg font-bold">Your supporters</h2>
          <DonorWall donations={donations} />
          <p className="mt-3 text-sm text-muted">
            Thank every one of them personally. It is the single highest-return
            thing you can do for next year&rsquo;s campaign.
          </p>
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
