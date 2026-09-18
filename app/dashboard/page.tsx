import Link from "next/link";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { SiteHeader, SiteFooter } from "@/components/SiteChrome";
import { JoinForm } from "@/components/participant/JoinForm";
import { card, buttonStyles } from "@/components/ui";
import { signedInPage } from "@/lib/page-guards";
import { db } from "@/lib/db";
import { memberships } from "@/lib/db/schema";
import { getOrg } from "@/lib/queries/campaigns";
import { listMyParticipations } from "@/lib/queries/participants";

export const dynamic = "force-dynamic";

/** Role router: admins → /admin; a single participation → its console; otherwise a picker + join form. */
export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ denied?: string; all?: string }> }) {
  const user = await signedInPage();
  const { denied, all } = await searchParams;

  const [membership] = await db.select().from(memberships).where(eq(memberships.userId, user.id)).limit(1);
  if (membership && !denied) redirect("/admin");

  const mine = await listMyParticipations(user.id);
  if (mine.length === 1 && !all && !denied) redirect(`/dashboard/${mine[0]!.participant.id}`);

  const org = await getOrg();

  return (
    <>
      <SiteHeader orgName={org?.name} />
      <main className="mx-auto w-full max-w-2xl flex-1 space-y-8 px-4 py-12">
        {denied === "admin" ? (
          <p role="alert" className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
            That page is for campaign administrators.
          </p>
        ) : null}

        <h1 className="text-2xl font-bold">Hi{user.name ? `, ${user.name.split(" ")[0]}` : ""}</h1>

        {mine.length > 0 ? (
          <section>
            <h2 className="mb-3 text-lg font-bold">Your campaigns</h2>
            <ul className="space-y-2">
              {mine.map(({ participant, campaign }) => (
                <li key={participant.id} className={`${card} flex items-center justify-between gap-3 p-4`}>
                  <div>
                    <div className="font-semibold">{campaign.name}</div>
                    <div className="text-sm text-muted">as {participant.displayName}</div>
                  </div>
                  <Link href={`/dashboard/${participant.id}`} className={buttonStyles.primary}>Open</Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section className={`${card} p-6`}>
          <h2 className="text-lg font-bold">{mine.length ? "Join another campaign" : "Join a campaign"}</h2>
          <p className="mt-1 text-sm text-muted">Enter the six-character code from your coach or campaign admin.</p>
          <JoinForm />
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
