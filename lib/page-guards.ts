import { redirect } from "next/navigation";
import { AuthError, requireAnyOrgAdmin, requireUser } from "./authz";

/**
 * Page-level guards. Layouts are the wrong place for this in Next.js — they do
 * not re-run on every navigation — so each protected page calls one of these.
 */
export async function adminPage() {
  try {
    return await requireAnyOrgAdmin();
  } catch (err) {
    if (err instanceof AuthError) {
      redirect(err.code === "UNAUTHENTICATED" ? "/sign-in" : "/dashboard?denied=admin");
    }
    throw err;
  }
}

export async function signedInPage() {
  try {
    return await requireUser();
  } catch (err) {
    if (err instanceof AuthError) redirect("/sign-in");
    throw err;
  }
}
