import { notFound, redirect } from "next/navigation";
import { AuthError, requireAnyOrgAdmin, requireParticipantOwner, requireUser } from "./authz";

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

/** A participant's own console. Someone else's id 404s rather than confirming it exists. */
export async function participantOwnerPage(participantId: string) {
  try {
    return await requireParticipantOwner(participantId);
  } catch (err) {
    if (err instanceof AuthError) {
      if (err.code === "UNAUTHENTICATED") redirect(`/sign-in?redirect_url=/dashboard/${participantId}`);
      notFound();
    }
    throw err;
  }
}
