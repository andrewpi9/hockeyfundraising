import Link from "next/link";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { SiteHeader, SiteFooter } from "@/components/SiteChrome";
import { card, buttonStyles } from "@/components/ui";
import { signedInPage } from "@/lib/page-guards";
import { db } from "@/lib/db";
import { memberships } from "@/lib/db/schema";
import { getOrg } from "@/lib/queries/campaigns";
import { listMyParticipations } from "@/lib/queries/participants";

export const dynamic = "force-dynamic";

/** Role router: admins go to /admin; participants to their campaign consoles. */
export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ denied?: string }> }) {
  const user = await signedInPage();
  const { denied } = await searchParams;

  const [membership] = await db.select().from(memberships).where(eq(memberships.userId, user.id)).limit(1);
  if (membership && !denied) redirect("/admin");

  const org = await getOrg();
  const mine = await listMyParticipations(user.id);

  return (
    <>
      <SiteHeader orgName={org?.name} />
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-12">
        {denied === "admin" ? (
          <p role="alert" className="mb-6 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
            That page is for campaign administrators.
          </p>
        ) : null}

        <h1 className="text-2xl font-bold">Hi{user.name ? `, ${user.name.split(" ")[0]}` : ""}</h1>

        {mine.length > 0 ? (
          <section className="mt-6">
            <h2 className="mb-3 text-lg font-bold">Your campaigns</h2>
            <ul className="space-y-2">
              {mine.map(({ participant, campaign }) => (
                <li key={participant.id} className={`${card} flex items-center justify-between gap-3 p-4`}>
                  <div>
                    <div className="font-semibold">{campaign.name}</div>
                    <div className="text-sm text-muted">as {participant.displayName}</div>
                  </div>
                  <Link href={`/c/${campaign.slug}/${participant.slug}`} className={buttonStyles.outline}>
                    View page
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : (
          <section className={`${card} mt-6 p-6`}>
            <h2 className="text-lg font-bold">You&rsquo;re not in a campaign yet</h2>
            <p className="mt-2 text-muted">
              Your coach or campaign admin will give you a six-character join code. Once you have it,
              you can join from this page.
            </p>
          </section>
        )}
      </main>
      <SiteFooter />
    </>
  );
}
