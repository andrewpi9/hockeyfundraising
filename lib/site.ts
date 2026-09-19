/**
 * Absolute URL builder. Share links, QR codes, emails and Stripe return URLs
 * all use it, so it must be right on every host:
 *   1. NEXT_PUBLIC_SITE_URL when set (custom domain),
 *   2. else Vercel's own production URL for the project,
 *   3. else the current deployment's URL (previews),
 *   4. else localhost.
 */
export function siteUrl(path = ""): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL;
  const vercelProd = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  const vercelThis = process.env.VERCEL_URL;
  const base = configured ?? (vercelProd ? `https://${vercelProd}` : vercelThis ? `https://${vercelThis}` : "http://localhost:3000");
  return `${base.replace(/\/$/, "")}${path}`;
}

/** True only in the deployed production environment, never during `next build`. */
export const isProductionDeploy = () =>
  process.env.VERCEL_ENV === "production" || process.env.APP_ENV === "production";
