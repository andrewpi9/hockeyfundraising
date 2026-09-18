import Link from "next/link";
import { SiteHeader, SiteFooter } from "@/components/SiteChrome";

export function AdminShell({
  orgName,
  title,
  actions,
  children,
}: {
  orgName: string;
  title: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <>
      <SiteHeader orgName={orgName} />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
        <nav className="mb-6 text-sm text-muted">
          <Link href="/admin" className="hover:underline">
            Admin
          </Link>
        </nav>
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-bold">{title}</h1>
          {actions}
        </div>
        {children}
      </main>
      <SiteFooter />
    </>
  );
}

export function StatusBadge({ status }: { status: "draft" | "active" | "closed" }) {
  const styles = {
    draft: "bg-stone-100 text-stone-700 dark:bg-navy-800 dark:text-stone-300",
    active: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300",
    closed: "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300",
  }[status];
  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide ${styles}`}>
      {status}
    </span>
  );
}
