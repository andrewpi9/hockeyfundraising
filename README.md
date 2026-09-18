# UNC Hockey Fundraising

A self-hosted team fundraising platform. Same model as Vertical Raise — a campaign
page, per-player pages, contact outreach, a coach dashboard — but with **no platform
fee and no suggested tip**. The only cost is card processing, and donors are given
the option to cover that themselves.

## What it costs to run

| | Commercial platform | This |
|---|---|---|
| Platform fee | ~20% | $0 |
| Suggested tip | ~15% | none |
| Card processing | rolled into the 20% | 2.2% + $0.30 (501(c)(3) rate) |
| ACH / bank transfer | — | 0.8%, capped at $5 |
| **Net on $20,000 raised** | **~$16,000** | **~$19,400** |

When a donor leaves the "cover processing" box checked, the team nets the full
gift. Historically 80–90% of donors leave it checked, which puts the effective
take-home near 100%.

Infrastructure: domain ~$12/yr, Vercel hobby $0, Postgres $0–19/mo, Resend free
to 3k emails/mo. Under $25/month.

---

## Before you take a single dollar

These are not technical problems, and they matter more than the code.

1. **The Stripe account must belong to the booster club, not a person.** If it is
   in an individual's name, every donation is legally that person's income and
   Stripe issues them a 1099-K for the gross. Open the Stripe account under the
   501(c)(3)'s EIN and bank account.
2. **Apply for Stripe's nonprofit rate** at [stripe.com/docs/nonprofit](https://stripe.com/docs/nonprofit).
   Until it is approved you are billed the standard 2.9% + $0.30, and the
   "cover the fee" math in `lib/money.ts` will under-collect by about 0.7%.
   Keep `STRIPE_PERCENT` in sync with the rate you are actually charged.
3. **Check with UNC Club Sports.** Many universities require donations for a club
   team to route through a university gift account, and some prohibit outside
   payment processors. Confirm the booster club is allowed to solicit independently
   before launching.
4. **North Carolina charitable solicitation license.** NC requires a license to
   solicit contributions, filed with the Secretary of State. Some organizations are
   exempt — confirm which applies to you.
5. **Fill in the real org details** in `.env`. `NEXT_PUBLIC_ORG_LEGAL_NAME`,
   `NEXT_PUBLIC_ORG_EIN` and `NEXT_PUBLIC_ORG_ADDRESS` print on every receipt.
   IRS Pub. 1771 requires the organization name, the amount, and a statement about
   goods or services — the receipt template handles the last part.

---

## Local setup

Requires Node 20.12+ (uses `process.loadEnvFile`).

```bash
npm install
cp .env.example .env.local
```

Start the bundled development database — Postgres compiled to WASM, no Docker and
no install:

```bash
npm run db:dev        # listens on 127.0.0.1:5433, data persists in .devdb/
```

Then in a second terminal:

```bash
npm run db:seed -- you@unc.edu    # creates a campaign and makes you the coach
npm run dev
```

Open http://localhost:3000 and sign in at `/login` with the email you seeded.
With no `RESEND_API_KEY` configured, **magic links are printed to the dev server
console** instead of emailed — copy the URL from the terminal.

> The dev database accepts **one connection at a time**. The Next.js dev server
> holds it, so a separate script that queries the database will fail while `npm run
> dev` is running. Stop one to use the other, or point `DATABASE_URL` at a real
> Postgres. This limitation applies only to `npm run db:dev`.

### Using a real Postgres instead

Any Postgres works — [Neon](https://neon.tech) and [Supabase](https://supabase.com)
both have usable free tiers. Set `DATABASE_URL` to the **pooled** connection string,
then `npm run db:push` to create the tables.

## Testing payments

```bash
stripe listen --forward-to localhost:3000/api/webhooks/stripe
```

Copy the `whsec_...` it prints into `STRIPE_WEBHOOK_SECRET`, then donate with test
card `4242 4242 4242 4242`, any future expiry, any CVC. The donation stays `pending`
until the webhook confirms it, which is what promotes it to `succeeded` and sends
the receipt.

## Commands

| | |
|---|---|
| `npm run dev` | development server |
| `npm run db:dev` | bundled WASM Postgres on :5433 |
| `npm run db:seed -- email` | create a campaign, make that email the coach |
| `npm run db:generate` | generate a migration after editing the schema |
| `npm run db:push` | apply the schema to the database |
| `npm run db:studio` | browse the data |
| `npm run verify` | full test suite against in-process Postgres |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |

---

## How it works

### Outreach: players send their own messages

Commercial platforms bulk-send texts from their own infrastructure. Doing that
yourself requires A2P 10DLC carrier registration through Twilio — an EIN, one to
three weeks of review, per-message cost, and ongoing carrier filtering that
silently drops traffic.

This skips all of it. A player adds contacts, and the app builds a prefilled
`sms:` or `mailto:` link containing their personal tracked URL. Tapping it opens
the player's **own** Messages or Mail app with the note already written. The message
arrives from a number the recipient recognizes, which converts far better than a
shortcode blast, costs nothing, and carries no carrier compliance burden.

Tracking still works, because the link is unique per contact.

### Attribution

Every share link is a short code at `/r/<code>`. Visiting it records the click and
forwards to `/p/<player>?ref=<code>`. The donate form passes `ref` through checkout,
so a gift is traceable to the individual contact who was messaged. A gift with no
`ref` falls back to the player page it came from; one given straight from the team
page is credited to the team.

### Money

`lib/money.ts` is the single source of truth. `grossUpForFees(net)` returns the
charge that leaves the team with exactly `net` after Stripe takes its cut — for a
$100 gift at the nonprofit rate that is $102.56, not $102.55, which would leave the
team a cent short. The test suite asserts no shortfall across the full range of
amounts.

Donation rows are written as `pending` before redirecting to Stripe and only become
`succeeded` when the webhook confirms payment. Totals, leaderboards and the donor
wall all filter on `succeeded`, so abandoned checkouts never appear anywhere public.

### Security

- Card details never touch the server — Stripe Checkout keeps this at PCI SAQ-A.
- Sign-in is passwordless. Tokens are single-use, expire in 15 minutes, and only
  the SHA-256 hash is stored.
- **Login cannot create accounts.** Links are only issued to emails already on the
  roster, so the coach's roster is the access list.
- The sign-in form returns an identical response for any email, including when
  delivery fails, so it cannot be used to enumerate who is on the team.
- Sessions are signed JWTs in an `HttpOnly`, `SameSite=Lax` cookie.
- The donor CSV is admin-only and served `no-store` — it contains email addresses.
- Anonymous donors are hidden on the public wall but preserved in the admin export,
  so the treasurer can still write a thank-you note.
- The donate endpoint is rate limited per IP against card testing.

The rate limiter is in-process memory: it does not survive a redeploy and is
per-instance. Once you are live, also turn on **Stripe Radar** and put **Cloudflare**
in front of the domain. Setting `TURNSTILE_SECRET_KEY` and
`NEXT_PUBLIC_TURNSTILE_SITE_KEY` activates captcha verification on checkout; without
them that check is skipped.

---

## Deploying

1. Push to GitHub, import the repo in Vercel.
2. Set every variable from `.env.example` in Vercel's environment settings.
   `SESSION_SECRET` should be a fresh `openssl rand -base64 32` — not the dev one.
3. Point `DATABASE_URL` at the pooled connection string and run `npm run db:push`.
4. Add the production webhook in Stripe → Developers → Webhooks:
   `https://yourdomain.org/api/webhooks/stripe`, subscribed to
   `checkout.session.completed` and `charge.refunded`. Put its signing secret in
   `STRIPE_WEBHOOK_SECRET`.
5. Verify your sending domain in Resend and set the SPF and DKIM records, or
   receipts will land in spam.
6. Set `NEXT_PUBLIC_SITE_URL` to the real domain — share links are built from it.
7. Switch Stripe from test keys to live keys last, and make one real $1 donation
   to yourself end to end before sending anything to the team.

## Running a campaign

The dashboard's roster table is the thing to watch. **Contacts loaded but zero
messages sent** is the number to chase — that player is one nudge away from their
entire total. Players who send 20+ messages raise roughly three times as much as
those who send five.

Two things move the number more than anything technical:

- **Specific, itemized goals.** "Ice time is $340 an hour and we need 60 hours"
  outperforms "support our program."
- **The players' own stories, in their own words.** A generic team page raises a
  fraction of what personal pages do.

## Stack

Next.js 16 (App Router) · TypeScript · Postgres + Drizzle · Stripe Checkout ·
Resend · Tailwind 4

## Known limitations

- `npm audit` reports moderate advisories in `drizzle-kit`'s dev-only esbuild
  dependency. It does not ship in the production bundle. Fixing it requires
  downgrading drizzle-kit to 0.18, which is not worth it.
- A partial refund marks the whole donation `refunded` and removes it from totals.
  The treasurer reconciles the difference in Stripe.
- Player photos are pasted URLs; there is no upload. Add a storage bucket if you
  want real uploads.
