import Link from "next/link";
import Image from "next/image";
import { Show, SignInButton, SignUpButton, UserButton } from "@clerk/nextjs";
import { brand } from "@/lib/brand";
import { buttonStyles } from "./ui";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-30 bg-navy-900 text-white shadow-lg shadow-navy-950/30">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-2.5">
        <Link href="/" className="flex items-center gap-3">
          <Image src={brand.mark} alt="" width={44} height={44} priority className="size-11 object-contain" />
          <span className="font-display text-2xl font-bold uppercase leading-none tracking-wide">{brand.name}</span>
        </Link>
        <nav className="flex items-center gap-2">
          <Show when="signed-in">
            <Link href="/dashboard" className={buttonStyles.onDark}>
              Dashboard
            </Link>
            <UserButton />
          </Show>
          <Show when="signed-out">
            <SignInButton mode="modal">
              <button type="button" className={buttonStyles.onDark}>
                Sign in
              </button>
            </SignInButton>
            <SignUpButton mode="modal">
              <button type="button" className={`${buttonStyles.primary} px-4 py-1.5 text-sm`}>
                Sign up
              </button>
            </SignUpButton>
          </Show>
        </nav>
      </div>
      <div className="argyle h-2.5" aria-hidden />
    </header>
  );
}

export function SiteFooter({ org }: { org?: { legalName?: string | null; ein?: string | null; address?: string | null } | null }) {
  return (
    <footer className="mt-16 bg-navy-900 text-carolina-100">
      <div className="argyle h-2.5" aria-hidden />
      <div className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-10 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-center gap-3">
          <Image src={brand.mark} alt="" width={40} height={40} className="size-10 object-contain" />
          <div>
            <div className="font-display text-xl font-bold uppercase leading-none text-white">{brand.name}</div>
            <div className="mt-1 text-xs text-carolina-300">{brand.tagline}</div>
          </div>
        </div>
        <div className="text-sm sm:text-right">
          {org?.legalName ? <p className="font-medium text-white">{org.legalName}</p> : null}
          {org?.address ? <p className="mt-0.5">{org.address}</p> : null}
          {org?.ein ? <p className="mt-0.5">EIN {org.ein} &middot; Donations are tax-deductible to the extent allowed by law.</p> : null}
          <p className="mt-3 max-w-md text-xs text-carolina-300 sm:ml-auto">
            Payments are processed by Stripe and settle directly to the organization. This site never stores card numbers and never sells donor information.
          </p>
        </div>
      </div>
    </footer>
  );
}
