/**
 * Runs before every matched request. Two jobs:
 *   1. Clerk session handling + a per-request nonce CSP (Clerk's strict mode
 *      generates the nonce and injects its own required hosts).
 *   2. Static security headers.
 *
 * This is NOT where authorization happens. Server Actions are POSTs to their
 * page route and can slip past a matcher, so every action and route handler
 * authorizes itself via lib/authz. Anything here is defense in depth.
 */
import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

const isDev = process.env.NODE_ENV === "development";

export default clerkMiddleware(
  async () => {
    const res = NextResponse.next();
    res.headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
    res.headers.set("X-Content-Type-Options", "nosniff");
    res.headers.set("X-Frame-Options", "DENY");
    res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
    res.headers.set("Cross-Origin-Opener-Policy", "same-origin");
    res.headers.set(
      "Permissions-Policy",
      "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()",
    );
    return res;
  },
  {
    contentSecurityPolicy: {
      strict: true,
      directives: {
        // Cloudflare Turnstile on the donate form.
        "script-src": ["https://challenges.cloudflare.com"],
        "frame-src": ["https://challenges.cloudflare.com"],
        "connect-src": ["https://challenges.cloudflare.com"],
        // Participant photos are pasted URLs until uploads land; images cannot
        // execute, so https: is the accepted tradeoff for now.
        "img-src": ["'self'", "data:", "blob:", "https:"],
        "font-src": ["'self'", "data:"],
        "object-src": ["'none'"],
        "base-uri": ["'self'"],
        "form-action": ["'self'"],
        "frame-ancestors": ["'none'"],
        ...(isDev ? {} : { "upgrade-insecure-requests": [] }),
      },
    },
  },
);

export const config = {
  matcher: [
    // Everything except static assets. Stripe/Clerk webhooks are under /api and
    // ARE matched: Clerk's middleware is a no-op for them (no session), and the
    // security headers do no harm on JSON.
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
    "/__clerk/(.*)",
  ],
};
