import Link from "next/link";
import { SignedIn, SignedOut, SignInButton, UserButton } from "@clerk/nextjs";
import { buttonStyles } from "./ui";

export function SiteHeader({ orgName = "Booster Club" }: { orgName?: string }) {
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-bg/85 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
        <Link href="/" className="font-bold">
          {orgName}
        </Link>
        <nav className="flex items-center gap-2">
          <SignedIn>
            <Link href="/dashboard" className={buttonStyles.ghost}>
              Dashboard
            </Link>
            <UserButton />
          </SignedIn>
          <SignedOut>
            <SignInButton mode="modal">
              <button type="button" className={buttonStyles.ghost}>
                Sign in
              </button>
            </SignInButton>
          </SignedOut>
        </nav>
      </div>
    </header>
  );
}

export function SiteFooter({
  org,
}: {
  org?: { legalName?: string | null; ein?: string | null; address?: string | null } | null;
}) {
  return (
    <footer className="mt-16 border-t border-border py-8">
      <div className="mx-auto max-w-5xl px-4 text-sm text-muted">
        {org?.legalName ? <p className="font-medium text-fg">{org.legalName}</p> : null}
        {org?.address ? <p className="mt-0.5">{org.address}</p> : null}
        {org?.ein ? (
          <p className="mt-0.5">
            EIN {org.ein} &middot; Donations are tax-deductible to the extent allowed by law.
          </p>
        ) : null}
        <p className="mt-3 text-xs">
          Payments are processed by Stripe and settle directly to the organization. This
          site never stores card numbers and never sells donor information.
        </p>
      </div>
    </footer>
  );
}
