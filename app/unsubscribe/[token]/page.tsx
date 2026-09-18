import { SiteHeader, SiteFooter } from "@/components/SiteChrome";
import { UnsubscribeForm } from "@/components/participant/UnsubscribeForm";
import { card } from "@/components/ui";
import { verifyUnsubscribeToken } from "@/lib/crypto";
import { getOrg } from "@/lib/queries/campaigns";

export const dynamic = "force-dynamic";

/** Visiting changes nothing; the button does. Scanners that prefetch links must not unsubscribe people. */
export default async function UnsubscribePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const org = await getOrg();
  const valid = Boolean(verifyUnsubscribeToken(token));

  return (
    <>
      <SiteHeader orgName={org?.name} />
      <main className="mx-auto w-full max-w-md flex-1 px-4 py-16">
        <div className={`${card} p-7`}>
          {valid ? (
            <>
              <h1 className="text-xl font-bold">Unsubscribe</h1>
              <p className="mt-2 text-muted">
                Stop receiving fundraising email from {org?.name ?? "this organization"}&rsquo;s participants? This applies to every campaign, not just the one that emailed you.
              </p>
              <UnsubscribeForm token={token} />
            </>
          ) : (
            <>
              <h1 className="text-xl font-bold">This link isn&rsquo;t valid</h1>
              <p className="mt-2 text-muted">It may have been altered in transit. Reply to the email you received and ask to be removed.</p>
            </>
          )}
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
