/** Absolute URL builder. Share links, QR codes and Stripe return URLs all use it. */
export function siteUrl(path = ""): string {
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  return `${base.replace(/\/$/, "")}${path}`;
}

/** True only in the deployed production environment, never during `next build`. */
export const isProductionDeploy = () =>
  process.env.VERCEL_ENV === "production" || process.env.APP_ENV === "production";
