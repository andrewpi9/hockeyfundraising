import Link from "next/link";
import { redirect } from "next/navigation";
import { and, eq, gt, isNull } from "drizzle-orm";
import { SiteHeader, SiteFooter } from "@/components/SiteChrome";
import { AcceptInviteForm } from "@/components/participant/JoinForm";
import { card, buttonStyles } from "@/components/ui";
import { db } from "@/lib/db";
import { participantInvites, campaigns, participants } from "@/lib/db/schema";
import { optionalUser } from "@/lib/authz";
import { blindIndex } from "@/lib/crypto";
import { hashToken } from "@/lib/tokens";
import { getOrg } from "@/lib/queries/campaigns";

export const dynamic = "force-dynamic";

/**
 * Landing for an invite link. Nothing is consumed by visiting: accepting is an
 * explicit POST, so an email scanner prefetching the URL cannot claim it.
 */
export default async function JoinPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const user = await optionalUser();
  if (!user) redirect(`/sign-in?redirect_url=${encodeURIComponent(`/join/${token}`)}`);

  const org = await getOrg();
  const [row] = await db
    .select({ invite: participantInvites, campaign: campaigns, claimName: participants.displayName })
    .from(participantInvites)
    .innerJoin(campaigns, eq(participantInvites.campaignId, campaigns.id))
    .leftJoin(participants, eq(participantInvites.participantId, participants.id))
    .where(and(eq(participantInvites.tokenHash, hashToken(token)), isNull(participantInvites.acceptedAt), gt(participantInvites.expiresAt, new Date())))
    .limit(1);

  const matchesMe = row ? blindIndex("email", user.email) === row.invite.emailBlindIndex : false;

  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-md flex-1 px-4 py-16">
        <div className={`${card} p-7`}>
          {!row ? (
            <>
              <h1 className="text-xl font-bold">This invitation isn&rsquo;t valid</h1>
              <p className="mt-2 text-muted">It may have expired or already been used. Ask your coach to send a new one.</p>
              <Link href="/dashboard" className={`${buttonStyles.outline} mt-6`}>Go to your dashboard</Link>
            </>
          ) : !matchesMe ? (
            <>
              <h1 className="text-xl font-bold">Sent to a different address</h1>
              <p className="mt-2 text-muted">
                This invitation to <strong>{row.campaign.name}</strong> was sent to a different email than the one you&rsquo;re signed in with
                ({user.email}). Sign in with that address, or ask your coach to re-send it here.
              </p>
            </>
          ) : (
            <>
              <p className="text-sm font-semibold uppercase tracking-widest text-carolina-600">{org?.name}</p>
              <h1 className="mt-1 text-xl font-bold">Join {row.campaign.name}</h1>
              <p className="mt-2 text-muted">
                {row.claimName
                  ? `Your coach already set up a page for you as ${row.claimName}. Accepting connects it to this account, with everything raised so far.`
                  : "You\u2019ll get a personal fundraising page and a share link."}
              </p>
              <AcceptInviteForm token={token} />
            </>
          )}
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
