# Booster Fundraising Platform

A group fundraising platform for a booster organization: admins run campaigns,
student-athletes join and share a personal page, donors give through Stripe
Checkout on the **organization's own Stripe account**. The platform records who
raised what; it never holds, pools or forwards money.

The platform fee is 0% and is disclosed on every page before checkout. The
only cost is Stripe's card processing, and donors are offered the option to
cover it so the full gift reaches the program.

---

## Contents

- [How money moves](#how-money-moves)
- [Before you launch](#before-you-launch)
- [Local development](#local-development)
- [Environment variables](#environment-variables)
- [Architecture](#architecture)
- [Security posture](#security-posture)
- [What a reviewer should know](#what-a-reviewer-should-know)
- [Deploying](#deploying)
- [Operations](#operations)
- [Testing](#testing)
- [Known limitations](#known-limitations)

---

## How money moves

```
donor ──▶ /api/checkout ──▶ Stripe Checkout (org's account) ──▶ org's bank
              │                        │
              │ writes donation        │ signed webhook
              │ status = pending       ▼
              └──────────────▶ /api/webhooks/stripe ──▶ status = succeeded
                                                        receipt emailed
```

1. The donate form POSTs to `/api/checkout`. The server validates, computes
   every amount itself, encrypts the donor's name/email/note, writes a
   `pending` donation row, and creates a Checkout Session with the org's
   **restricted** Stripe key. The donor is redirected to Stripe.
2. Card details never touch this application (PCI SAQ-A).
3. Stripe settles funds directly to the org. It then sends a webhook. Only a
   signature-verified `checkout.session.completed` event can promote a
   donation to `succeeded`, and only after the charged amount matches what
   the server asked for. Nothing on the request path can mint a paid gift.
4. Refunds are issued by the org in the **Stripe Dashboard**, never here — the
   restricted key cannot do it. The webhook updates our records.

| | |
|---|---|
| Platform fee | **0%**, shown before checkout |
| Card processing | Stripe's rate (2.9% + 30¢; 2.2% once approved for the nonprofit rate) |
| Fee covered by donor | optional, pre-checked, clearly labelled |
| Where money settles | the org's own Stripe account → the org's bank |

---

## Before you launch

These are not code problems, and they gate the launch.

1. **The org creates the Stripe key, not you.** In the org's Stripe Dashboard →
   Developers → API keys → *Create restricted key* with exactly:
   **Checkout Sessions: Write** and **Payment Intents: Read**. Nothing else.
   The app refuses an unrestricted `sk_` key in every environment and refuses
   a test key in production. Verify the permission set using Stripe's own
   procedure: run the flow in a sandbox with the RAK and read the key's
   request logs for 403s.
2. **The org creates the webhook endpoint** pointing at
   `https://<your-domain>/api/webhooks/stripe` with events
   `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
   `checkout.session.async_payment_failed`, `charge.refunded`,
   `charge.dispute.created`, and hands you the signing secret.
3. **Apply for Stripe's nonprofit rate.** Until approved, leave
   `NEXT_PUBLIC_STRIPE_FEE_PERCENT=2.9`. The default over-collects slightly
   rather than under-collecting the org.
4. **Confirm the org can solicit.** North Carolina requires a charitable
   solicitation license unless exempt. If the org is a university club or
   program, confirm with the university that independent solicitation is
   allowed.
5. **Enter the org's legal name, EIN and postal address** at `/admin/settings`.
   Receipts print them (IRS Pub. 1771), and **no outreach email can be sent
   until the address is on file** (CAN-SPAM).
6. **Verify the sending domain in Resend** and publish SPF, DKIM and DMARC.
   Without them receipts and invites land in spam and the domain's reputation
   is at risk from day one.

---

## Local development

Requires Node 20.12+.

```bash
npm install
cp .env.example .env.local
npm run keys:generate        # paste the three PII_* lines into .env.local
```

**Clerk keys are required to run the app**, even locally — there is no
password fallback by design. Create a free Clerk application, copy its
publishable and secret keys into `.env.local`, and add your own email to
`BOOTSTRAP_ADMIN_EMAILS`.

Start the bundled Postgres (WASM, no Docker), then the app:

```bash
npm run db:dev               # 127.0.0.1:5433, data persists in .devdb/
npm run db:seed              # creates the organization row
npm run dev
```

Sign in at `/sign-in`. The bootstrap email becomes org owner on first sign-in
(audited), then `/admin` lets you create a campaign.

> The dev database accepts **one connection at a time**. Stop `npm run dev`
> before running another script against it, or point `DATABASE_URL` at a real
> Postgres (Neon and Supabase both have free tiers). This applies only to
> `npm run db:dev`.

Without `RESEND_API_KEY`, every email is printed to the dev server console
instead of sent. Without Upstash credentials, rate limits are in-memory
(development only; production refuses to start). Without
`BLOB_READ_WRITE_TOKEN`, photo uploads fail closed with a clear message.

### Testing payments locally

```bash
stripe listen --forward-to localhost:3000/api/webhooks/stripe
```

Put the printed `whsec_…` in `STRIPE_WEBHOOK_SECRET`. Donate with test card
`4242 4242 4242 4242`. The donation stays `pending` until the forwarded
webhook arrives, which is what promotes it and sends the receipt.

### Commands

| | |
|---|---|
| `npm run dev` / `build` / `start` | Next.js |
| `npm run db:dev` | bundled WASM Postgres on :5433 |
| `npm run db:seed` | create the organization row |
| `npm run db:import -- data/<file>.json [--replace]` | load a previous campaign's roster and donations (see below) |
| `npm run roster:sync -- --campaign <slug> [--json data/<file>.json]` | pull headshots, numbers, positions and years from the team's public roster page |
| `npm run db:generate` / `db:push` | migrations |
| `npm run keys:generate` | fresh PII encryption + index keys |
| `npm run verify` | 286-check suite against in-process Postgres |
| `npm run typecheck` / `lint` | |

---

## Environment variables

Everything lives in env / your host's secret manager. Nothing is committed.
`.env.example` documents every key; the important groupings:

| Group | Keys | Notes |
|---|---|---|
| Database | `DATABASE_URL` | Connect as the `app` role from `scripts/grants.sql`, never as owner |
| Clerk | `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `CLERK_WEBHOOK_SIGNING_SECRET`, `BOOTSTRAP_ADMIN_EMAILS` | |
| Stripe | `STRIPE_SECRET_KEY` (**rk_**), `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_STRIPE_FEE_PERCENT`, `NEXT_PUBLIC_STRIPE_FEE_FIXED_CENTS` | Org-issued restricted key |
| PII encryption | `PII_ENCRYPTION_KEYS`, `PII_ENCRYPTION_ACTIVE_KEY_ID`, `PII_INDEX_KEY` | Keep the index key in a different scope from `DATABASE_URL` |
| Rate limiting | `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | Required in production |
| Email | `RESEND_API_KEY`, `EMAIL_FROM`, `RESEND_WEBHOOK_SECRET` | |
| Uploads | `BLOB_READ_WRITE_TOKEN` | Vercel Blob |
| Bot protection | `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | Optional; activates when set |
| Deploy env | `VERCEL_ENV` (auto) or `APP_ENV=production` | Gates live-key enforcement |

---

## Architecture

Next.js 16 App Router · TypeScript · Postgres + Drizzle · Clerk · Stripe
Checkout · Resend · Upstash · Vercel Blob · Tailwind 4.

### Routes

| Path | Who | What |
|---|---|---|
| `/` | public | active campaigns |
| `/c/[campaign]` | public | campaign page, live thermometer, leaderboard, donor wall, donate form |
| `/c/[campaign]/[participant]` | public | participant page with attribution (`?ref=`) |
| `/r/[code]` | public | tracked short link → participant page |
| `/qr/[code]` | public | SVG QR for a share link |
| `/thanks` | public | post-checkout confirmation |
| `/unsubscribe/[token]`, `POST /api/unsubscribe/[token]` | public | human and RFC 8058 one-click unsubscribe |
| `/api/checkout` | public, rate-limited | creates the Stripe session |
| `/api/campaigns/[id]/stats`, `/api/participants/[id]/stats` | public, cached | PII-free live numbers |
| `/api/webhooks/stripe` `clerk` `resend` | signed | idempotent event ingestion |
| `/dashboard` | signed in | role router + join by code |
| `/dashboard/[participantId]` | owner only | console: link, QR, contacts, supporters, profile |
| `/join/[token]` | signed in | accept an admin invite (explicit POST) |
| `/admin`, `/admin/campaigns/*`, `/admin/settings`, `/admin/audit` | org admin | management |
| `/api/admin/campaigns/[id]/export` | org admin, audited | donor CSV |

### Authorization model

Two kinds of authority, both derived from the Clerk session, never from a
client-supplied id:

- **Org membership** (`memberships.role` = owner/admin) authorizes campaign
  and roster management, settings, exports and the audit log.
- **Participant ownership** (`participants.user_id` = session user)
  authorizes profile edits, contacts and outreach for that one row.

Every Server Action and route handler calls a guard in `lib/authz.ts` first.
Where a client sends an id, it is a lookup hint; the `WHERE` clause carries the
session-derived owner. `proxy.ts` handles sessions and headers only — Next.js
16 and Clerk both document that route protection must live beside the data,
because Server Actions are POSTs to their page route and can slip past a
matcher.

### Encryption model

`lib/crypto.ts`. Column-level AES-256-GCM for every piece of third-party PII:
donor name, email and note; every imported contact; invite emails. The column
identity is bound as GCM additional authenticated data, so a ciphertext moved
between columns fails to decrypt. Envelopes carry a key id, so rotation is a
new key plus a background re-encrypt.

Equality lookups (dedupe, suppression, invite matching) use HMAC-SHA256
**blind indexes** under a separate key. Participant and admin emails on
`users` stay plaintext: they are identity, the auth layer queries by them, and
they are not donor data.

Decryption happens in exactly four places: the public donor wall (name and
note, name withheld for anonymous gifts), the owner's own contact list, the
receipt sender, and `lib/queries/admin-donations.ts` — which is admin-only and
audited on every read.

### Outreach pipeline

`lib/outreach.ts` is the only code that emails an imported contact. Every gate
is inside it: contact belongs to the sender · has an email · not unsubscribed
· not on the org-wide suppression list · not mailed in the last 7 days · at
most 25 per send · 100 per participant per day · list capped at 100 · org
postal address on file. Every message carries the org's address, a signed
unsubscribe link and a `List-Unsubscribe-Post` header. Bounces and complaints
arrive via the Resend webhook and suppress the address org-wide.

SMS is never sent by the platform. "Text" mints a per-contact tracked link and
opens the participant's own Messages app. No A2P 10DLC, no TCPA sender
obligations.

---

## Security posture

Mapped to the requirements this was built against.

| Requirement | Implementation |
|---|---|
| Managed auth, no homegrown passwords | Clerk (`proxy.ts`, `lib/authz.ts`). Auth.js v5 was rejected because it has never left beta. |
| Ownership check on every write | `lib/authz.ts` guards; session-scoped `WHERE` on every mutation |
| Server-side validation | Zod on every action and route (`lib/checkout-schema.ts`, action files) |
| Rate limiting | Upstash sliding windows per IP / user / participant (`lib/ratelimit.ts`); production fails closed without Redis |
| PII encrypted at rest | AES-256-GCM + AAD + blind indexes (`lib/crypto.ts`); IPs stored only as monthly-rotating HMACs |
| Never log PII | Action wrapper logs error messages only; audit writer rejects PII-shaped keys at runtime; webhook payloads are never stored |
| CSRF | Server Actions (Next.js origin check); the only unauthenticated POSTs are checkout (Turnstile + rate limit) and signed webhooks |
| HTTPS, secure cookies, headers | Clerk strict nonce CSP, HSTS preload, `frame-ancestors 'none'`, nosniff, referrer and permissions policies (`proxy.ts`) |
| Verified webhooks | Stripe `constructEvent`, Clerk `verifyWebhook`, Resend via Svix; all three keyed on a replay ledger |
| Secrets in env only | `.env.example` is placeholders; the commit hook scans staged diffs for key shapes |
| Audit log | Append-only (`scripts/grants.sql` revokes UPDATE/DELETE); covers admin writes, exports and donor-PII views; viewer at `/admin/audit` |
| Restricted Stripe key | `lib/stripe.ts` refuses `sk_` everywhere and test keys in production |
| Attribution only | No payout code exists. Funds settle to the org directly. |

---

## What a reviewer should know

Deliberate choices and honest limits, in the order I would want to be asked
about them.

1. **Blind indexes leak equality.** Anyone holding both the database and
   `PII_INDEX_KEY` can confirm a *guessed* email. Keep the index key out of
   the scope that holds `DATABASE_URL`. There is no equality lookup without
   this tradeoff short of searchable encryption, which is not warranted here.
2. **Keys are in environment variables, not KMS.** On Vercel that is
   encrypted at rest and exposed only to the runtime. The upgrade is a
   `KmsKeyProvider` behind the existing `KeyProvider` interface: IAM-scoped
   decrypt with its own audit trail. Nothing else changes.
3. **Participants do not see donor emails.** They see name, amount, date and
   note — enough to say thank you. Reversing this is a one-line change in
   `listDonorsForParticipant`, but it multiplies the breach surface by the
   roster size. Admins see emails, audited.
4. **Anonymous donors are anonymous to the participant too.** The admin
   export shows the real name so the org can send its own acknowledgment.
5. **Partially refunded gifts drop from public totals.** Conservative: totals
   never overstate. The refunded amount is recorded for reconciliation.
6. **The webhook trusts Stripe's `amount_total`** and cross-checks it against
   the server-computed pending row. A mismatch marks the donation failed. It
   does not trust the client's arithmetic at any point.
7. **`img-src` allows the Vercel Blob store and Clerk's CDN only.** Uploads
   are validated by magic bytes; SVG is refused because it can carry script.
8. **The dev rate limiter is in-memory and announces itself.** Production
   throws at first use without Upstash. There is no silent degradation.
9. **Turnstile is optional.** It activates when both keys are set. Turn it on
   before going live; public donate forms attract card-testing bots, and
   Stripe Radar should be enabled on the org's account as well.
10. **Clerk's keyless dev mode is not used.** The app requires real Clerk keys
    so no third-party resource is created implicitly.
11. **The contact cap (100), batch (25), daily send (100) and cooldown (7 d)**
    are constants in `lib/outreach.ts`, agreed before build.
12. **Emails HTML-escape every interpolated string** (`lib/html.ts`). The
    receipt, invite and outreach templates were reviewed for this.

---

## Deploying

Target: Vercel. Any Node 20 host works with `APP_ENV=production`.

1. Import the repo. Set every variable from `.env.example`. Generate
   **fresh** PII keys for production — never reuse development keys.
2. Provision Postgres (Neon/Supabase pooled URL). Run `npm run db:push`, then
   as the owner run `scripts/grants.sql` to create the least-privilege `app`
   role, and point `DATABASE_URL` at it.
3. Provision Upstash Redis and Vercel Blob; connect both to the project.
4. Clerk: production instance, set the webhook to `/api/webhooks/clerk`
   (`user.created`, `user.updated`, `user.deleted`), copy the signing secret.
5. Stripe: the **org** creates the restricted key and the webhook endpoint
   (see *Before you launch*), and hands you both secrets.
6. Resend: verify the domain; webhook to `/api/webhooks/resend`
   (`email.delivered`, `email.bounced`, `email.complained`).
7. Set `NEXT_PUBLIC_SITE_URL` to the real domain. Share links and QR codes
   are built from it.
8. Enable Turnstile. Enable Stripe Radar on the org's account.
9. Make one real $5 donation end to end and confirm the receipt, the audit
   row, and the settlement in the org's Stripe balance — before inviting a
   single participant.

---

## Importing a previous campaign

`npm run db:import -- data/<file>.json` loads a roster and its donation
history. Each participant becomes a row owned by a placeholder account (a
reserved `.invalid` address that cannot sign in); the admin roster marks them
**unclaimed** and offers a claim invite. When the real person accepts, the row
— page, links, totals — moves to their account rather than a duplicate being
created. Imported gifts are recorded with `source = import`: they count toward
the total and are excluded from Stripe fee estimates. If the file carries
expected per-participant counts and totals, they are reconciled before
anything is written. Keep data files under `data/` (gitignored — donor names).

## Team branding and roster photos

`lib/brand.ts` names the team and points at `public/brand/` (logo lockup,
square mark, favicon via `app/icon.png`). The organization row still holds
the legal identity for receipts.

`npm run roster:sync` reads the team's public roster page (`ROSTER_URL`,
default unchockey.com), matches players to participants by name — exact, or
same surname with a first-name prefix (Matt/Matthew) — and stores headshots
under `public/roster/<slug>.jpg`, served from this site so nothing hotlinks
the team site and the CSP stays `img-src 'self'`. A photo a participant
uploaded themselves is never overwritten. The parser is pure and tested
against the page's real markup (`lib/roster-scrape.ts`). Photos and the logo
are the team's own assets; confirm with the program before publishing.

## Bootstrapping a fresh deployment

Schema migrations run during the Vercel build (`build:vercel` = `drizzle-kit
migrate && next build`), so the database is always at the schema the running
code expects. Marketplace database credentials are hidden secrets that cannot
be pulled to a laptop, so the first data load happens through a one-time
endpoint: set `SETUP_TOKEN` (48 random bytes) in the project's env, deploy,
then `POST /api/setup` with `Authorization: Bearer <token>` and a body of
`{"op":"seed","name":"…"}` followed by `{"op":"import","payload":<roster
json>}`. **Remove `SETUP_TOKEN` immediately afterwards and redeploy** — while
it is unset the route returns 404.

## Operations

- **Rotate PII keys:** add a new id to `PII_ENCRYPTION_KEYS`, point
  `PII_ENCRYPTION_ACTIVE_KEY_ID` at it, deploy, re-encrypt in the background,
  then remove the old id. Never delete a key still referenced by a row.
- **Refunds and disputes:** handled in the org's Stripe Dashboard. The webhook
  updates our status and totals.
- **Remove a participant:** `/admin/campaigns/[id]` → Remove. Their page goes
  offline; attributed donations stay in the totals.
- **Revoke an admin:** remove the Clerk user or delete the `memberships` row.
- **Someone asks to stop receiving email:** the link in every message does
  it org-wide; or add a `suppressions` row by blind index.
- **Rotate a join code** once the roster is set.

---

## Testing

`npm run verify` runs 286 checks against an in-process Postgres with
ephemeral keys and no network. It covers: the encryption envelope, AAD and
rotation; blind-index normalization; IP hashing; the audit PII guard; rate
limiter semantics including batch cost; every schema constraint; campaign,
participant and donation queries including draft visibility and status
filtering; upload sniffing; click-privacy guarantees; CSV import parsing;
unsubscribe tokens; the full outreach gate set; the Stripe webhook state
machine (paid, ACH-delayed, mismatch, partial/full refund, dispute, replay);
donor-wall anonymity; CSV export formula neutralization; admin financials;
and the audit trail; roster import with reconciliation, claiming imported
rows, and mixed-source financials.

It does **not** exercise Clerk-gated pages (requires live Clerk keys) or
live Stripe/Resend calls. Those are verified by the end-to-end donation in
the deploy checklist.

---

## Known limitations

- `npm audit` reports moderate advisories in `drizzle-kit`'s dev-only esbuild
  dependency. It does not ship in the production bundle.
- No admin UI for creating a second organization; v1 is single-org by seed.
  The schema supports more.
- No receipt re-send button; a failed receipt is logged and can be re-sent by
  hand from the audit trail and Stripe record.
- Photo uploads require Vercel Blob; there is no alternate storage adapter.
