import Link from "next/link";
import { eq } from "drizzle-orm";
import { SiteHeader, SiteFooter } from "@/components/SiteChrome";
import { card, buttonStyles } from "@/components/ui";
import { formatMoney } from "@/lib/money";
import { db } from "@/lib/db";
import { donations, participants } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

export default async function ThanksPage({
  searchParams,
}: {
  searchParams: Promise<{ session_id?: string }>;
}) {
  const { session_id } = await searchParams;

  // Read-only confirmation. The webhook is what actually marks the gift paid,
  // so this page may briefly show a donation that is still settling.
  const [donation] = session_id
    ? await db
        .select({
          amountCents: donations.amountCents,
          feeCoveredCents: donations.feeCoveredCents,
          donorName: donations.donorName,
          status: donations.status,
          participantName: participants.displayName,
          participantSlug: participants.slug,
        })
        .from(donations)
        .leftJoin(participants, eq(donations.participantId, participants.id))
        .where(eq(donations.stripeSessionId, session_id))
        .limit(1)
    : [];

  return (
    <>
      <SiteHeader />

      <main className="mx-auto w-full max-w-lg flex-1 px-4 py-16">
        <div className={`${card} p-8 text-center`}>
          <div aria-hidden className="text-5xl">
            🏒
          </div>
          <h1 className="mt-4 text-2xl font-bold">
            Thank you{donation?.donorName ? `, ${donation.donorName.split(" ")[0]}` : ""}!
          </h1>

          {donation ? (
            <p className="mt-3 leading-relaxed text-muted">
              Your {formatMoney(donation.amountCents)} gift
              {donation.participantName ? ` to ${donation.participantName}` : ""} is
              in. A receipt is on its way to your inbox — keep it for your tax
              records.
            </p>
          ) : (
            <p className="mt-3 leading-relaxed text-muted">
              Your donation is confirmed. A receipt is on its way to your inbox.
            </p>
          )}

          <div className="mt-7 flex flex-wrap justify-center gap-3">
            <Link href="/" className={buttonStyles.primary}>
              Back to the campaign
            </Link>
            {donation?.participantSlug ? (
              <Link
                href={`/p/${donation.participantSlug}`}
                className={buttonStyles.outline}
              >
                See the player page
              </Link>
            ) : null}
          </div>

          <p className="mt-6 text-sm text-muted">
            The biggest thing you can do next is share the campaign with one
            other person.
          </p>
        </div>
      </main>

      <SiteFooter />
    </>
  );
}
