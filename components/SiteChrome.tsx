import Link from "next/link";
import { getSession } from "@/lib/auth";
import { buttonStyles } from "./ui";

export async function SiteHeader() {
  const session = await getSession();

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-bg/85 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
        <Link href="/" className="flex items-center gap-2 font-bold">
          <span aria-hidden className="text-xl">
            🏒
          </span>
          <span>UNC Hockey</span>
        </Link>

        <nav className="flex items-center gap-1.5">
          {session ? (
            <Link
              href={session.role === "admin" ? "/dashboard" : "/me"}
              className={buttonStyles.ghost}
            >
              {session.role === "admin" ? "Dashboard" : "My page"}
            </Link>
          ) : (
            <Link href="/login" className={buttonStyles.ghost}>
              Player login
            </Link>
          )}
          <Link href="/#donate" className={buttonStyles.primary}>
            Donate
          </Link>
        </nav>
      </div>
    </header>
  );
}

export function SiteFooter() {
  const org = process.env.NEXT_PUBLIC_ORG_LEGAL_NAME;
  const ein = process.env.NEXT_PUBLIC_ORG_EIN;
  const address = process.env.NEXT_PUBLIC_ORG_ADDRESS;

  return (
    <footer className="mt-16 border-t border-border py-8">
      <div className="mx-auto max-w-5xl px-4 text-sm text-muted">
        <p className="font-medium text-fg">{org}</p>
        {address ? <p className="mt-0.5">{address}</p> : null}
        {ein ? (
          <p className="mt-0.5">
            EIN {ein} &middot; Donations are tax-deductible to the extent allowed
            by law.
          </p>
        ) : null}
        <p className="mt-3 text-xs">
          Payments processed securely by Stripe. We never store card details and
          never sell donor information.
        </p>
      </div>
    </footer>
  );
}
