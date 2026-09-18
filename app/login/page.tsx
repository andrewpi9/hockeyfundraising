import { redirect } from "next/navigation";
import { SiteHeader, SiteFooter } from "@/components/SiteChrome";
import { LoginForm } from "@/components/LoginForm";
import { card } from "@/components/ui";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  missing: "That link was incomplete. Request a new one below.",
  expired: "That link has expired or was already used. Request a new one below.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await getSession();
  if (session) redirect(session.role === "admin" ? "/dashboard" : "/me");

  const { error } = await searchParams;

  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-md flex-1 px-4 py-16">
        <div className={`${card} p-7`}>
          <h1 className="text-xl font-bold">Player &amp; coach sign-in</h1>
          <p className="mt-1.5 text-sm text-muted">
            Enter the email your coach used to add you to the roster. We&rsquo;ll
            send you a sign-in link — no password to remember.
          </p>

          {error && ERRORS[error] ? (
            <p
              role="alert"
              className="mt-4 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
            >
              {ERRORS[error]}
            </p>
          ) : null}

          <LoginForm />
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
