import Link from "next/link";
import Image from "next/image";
import { SiteHeader, SiteFooter } from "@/components/SiteChrome";
import { Thermometer } from "@/components/Thermometer";
import { Avatar, buttonStyles, card } from "@/components/ui";
import { brand } from "@/lib/brand";
import { getOrg, listPublicCampaigns } from "@/lib/queries/campaigns";
import { listParticipantsWithTotals } from "@/lib/queries/participants";

export const dynamic = "force-dynamic";

/** Before the database exists the site is "setting up", not broken. */
async function loadOrg() {
  try {
    return { org: await getOrg(), ready: true };
  } catch (err) {
    console.error("[home] database unavailable:", err instanceof Error ? err.message : "unknown");
    return { org: null, ready: false };
  }
}

export default async function HomePage() {
  const { org, ready } = await loadOrg();
  if (!ready) {
    return (
      <main className="ice-hero grid min-h-screen place-items-center px-4 text-white">
        <div className="max-w-md text-center">
          <Image src={brand.logo} alt={brand.name} width={220} height={172} priority className="mx-auto w-44 drop-shadow-[0_12px_32px_rgba(75,156,211,0.4)]" />
          <h1 className="mt-6 font-display text-4xl font-bold uppercase">Setting up</h1>
          <p className="mt-3 text-carolina-100">The fundraising site is being connected. Check back shortly.</p>
        </div>
      </main>
    );
  }
  if (!org) {
    return (
      <main className="mx-auto w-full max-w-xl flex-1 px-4 py-24 text-center">
        <h1 className="text-2xl font-bold">Not set up yet</h1>
        <p className="mt-2 text-muted">
          Run <code className="font-mono text-sm">npm run db:seed</code> to create the organization.
        </p>
      </main>
    );
  }

  const campaigns = await listPublicCampaigns(org.id);
  const active = campaigns.filter((c) => c.status === "active");
  const closed = campaigns.filter((c) => c.status === "closed");
  const boards = await Promise.all(active.map((c) => listParticipantsWithTotals(c.id)));

  return (
    <>
      <SiteHeader />
      <main className="flex-1">
        <section className="ice-hero text-white">
          <div className="mx-auto flex max-w-5xl flex-col items-center gap-8 px-4 py-16 text-center sm:flex-row sm:gap-12 sm:text-left">
            <Image src={brand.logo} alt={brand.name} width={240} height={188} priority className="w-44 shrink-0 drop-shadow-[0_12px_32px_rgba(75,156,211,0.4)] sm:w-56" />
            <div>
              <p className="font-display text-sm font-semibold uppercase tracking-[0.3em] text-carolina-300">{brand.tagline}</p>
              <h1 className="mt-2 font-display text-5xl font-bold uppercase leading-[0.95] sm:text-7xl">Fund the season</h1>
              <p className="mx-auto mt-4 max-w-xl text-carolina-100 sm:mx-0">
                Ice time, travel and gear for {brand.name}. Every campaign here runs with a 0% platform fee — what you give goes to the program, minus only the card
                processor&rsquo;s cost, which you can choose to cover.
              </p>
            </div>
          </div>
        </section>

        <div className="mx-auto max-w-5xl space-y-12 px-4 py-12">
          <section>
            <h2 className="mb-4 font-display text-3xl font-bold uppercase">Active campaigns</h2>
            {active.length === 0 ? (
              <p className="text-muted">No campaigns are accepting donations right now.</p>
            ) : (
              <ul className={`grid gap-4 ${active.length > 1 ? "md:grid-cols-2" : ""}`}>
                {active.map((c, i) => {
                  const board = boards[i] ?? [];
                  const faces = board.slice(0, 6);
                  return (
                    <li key={c.id}>
                      <Link href={`/c/${c.slug}`} className={`${card} block p-6 transition hover:border-carolina-300 hover:shadow-md`}>
                        <h3 className="font-display text-2xl font-bold uppercase leading-tight">{c.name}</h3>
                        <div className="mt-4">
                          <Thermometer raisedCents={c.raisedCents} goalCents={c.goalCents} size="sm" />
                        </div>
                        <div className="mt-4 flex items-center justify-between gap-3">
                          <div className="flex -space-x-2">
                            {faces.map((f) => (
                              <Avatar key={f.id} src={f.photoUrl} name={f.displayName} size={32} className="ring-2 ring-card" />
                            ))}
                          </div>
                          <p className="text-sm text-muted">
                            {c.participantCount} {c.participantCount === 1 ? "player" : "players"} · {c.donorCount} {c.donorCount === 1 ? "donation" : "donations"}
                          </p>
                        </div>
                        <span className={`${buttonStyles.primary} mt-5 w-full`}>Support the team</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {closed.length > 0 ? (
            <section>
              <h2 className="mb-3 font-display text-2xl font-bold uppercase text-muted">Past campaigns</h2>
              <ul className="space-y-2">
                {closed.map((c) => (
                  <li key={c.id}>
                    <Link href={`/c/${c.slug}`} className="text-sm underline-offset-4 hover:underline">
                      {c.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      </main>
      <SiteFooter org={{ legalName: org.legalName, ein: org.ein, address: [org.addressLine1, org.city, org.state, org.postalCode].filter(Boolean).join(", ") || null }} />
    </>
  );
}
