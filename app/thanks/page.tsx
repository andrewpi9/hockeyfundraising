import Link from "next/link";
import { SiteHeader, SiteFooter } from "@/components/SiteChrome";
import { card, buttonStyles } from "@/components/ui";
import { formatMoney } from "@/lib/money";
import { getOrg } from "@/lib/queries/campaigns";
import { getDonationBySession } from "@/lib/queries/donations";

export const dynamic = "force-dynamic";

/**
 * Read-only confirmation. The webhook is what marks the gift paid, so a card
 * payment may show for a second or two as still processing; a bank debit will
 * show that way for days. Both are honest.
 */
export default async function ThanksPage({ searchParams }: { searchParams: Promise<{ session_id?: string }> }) {
  const { session_id } = await searchParams;
  const org = await getOrg();
  const donation = session_id && /^cs_(test|live)_[A-Za-z0-9]+$/.test(session_id) ? await getDonationBySession(session_id) : null;

  const settling = donation?.status === "pending";
  const bank = donation?.paymentMethodType === "us_bank_account";

  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-lg flex-1 px-4 py-16">
        <div className={`${card} p-8 text-center`}>
          <h1 className="text-2xl font-bold">Thank you{donation?.firstName ? `, ${donation.firstName}` : ""}.</h1>

          {donation ? (
            <>
              <p className="mt-3 leading-relaxed text-muted">
                Your {formatMoney(donation.amountCents)} gift{donation.participantName ? ` to ${donation.participantName}` : ""}
                {settling
                  ? bank
                    ? " is on its way. Bank transfers take a few business days to settle; your receipt will arrive when it does."
                    : " is being confirmed. Your receipt will arrive in a moment."
                  : " is in. A receipt is on its way to your inbox — keep it for your tax records."}
              </p>
              <div className="mt-7 flex flex-wrap justify-center gap-3">
                <Link href={`/c/${donation.campaignSlug}`} className={buttonStyles.primary}>Back to {donation.campaignName}</Link>
                {donation.participantSlug ? (
                  <Link href={`/c/${donation.campaignSlug}/${donation.participantSlug}`} className={buttonStyles.outline}>
                    {donation.participantName}&rsquo;s page
                  </Link>
                ) : null}
              </div>
            </>
          ) : (
            <>
              <p className="mt-3 leading-relaxed text-muted">Your donation is confirmed. A receipt is on its way to your inbox.</p>
              <Link href="/" className={`${buttonStyles.primary} mt-7`}>Back to campaigns</Link>
            </>
          )}

          <p className="mt-6 text-sm text-muted">The single most useful thing you can do next is share the page with one more person.</p>
        </div>
      </main>
      <SiteFooter org={org ? { legalName: org.legalName, ein: org.ein } : null} />
    </>
  );
}
