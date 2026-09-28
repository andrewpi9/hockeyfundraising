# Booster Fundraising Platform

Team fundraising where the whole gift reaches the program. Participants join a
campaign, share a personal page, and donors give through Stripe Checkout on the
**organization's own Stripe account**. The platform records who raised what; it
never holds, pools, or forwards money.

**0% platform fee. No suggested tip.** The only cost is card processing, and
donors are offered the option to cover it so the full amount reaches the program.

---

## Contents

- [How money moves](#how-money-moves)
- [Running before payments are connected](#running-before-payments-are-connected)
- [Before the first real donation](#before-the-first-real-donation)
- [Quick start](#quick-start)
- [Configuration](#configuration)
- [Architecture](#architecture)
- [Security](#security)
- [Design decisions](#design-decisions)
- [Deploying](#deploying)
- [Importing a previous campaign](#importing-a-previous-campaign)
- [Branding and roster photos](#branding-and-roster-photos)
- [Running a campaign](#running-a-campaign)
- [Testing](#testing)
- [Limitations](#limitations)

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

1. The donate form posts to `/api/checkout`. The server validates the request,
   computes every amount itself, encrypts the donor's name, email and note,
   writes a `pending` donation row, and creates a Checkout Session with the
   organization's **restricted** Stripe key. The donor is redirected to Stripe.
2. Card details never reach this application (PCI SAQ-A).
3. Stripe settles funds directly to the organization, then sends a webhook.
   Only a signature-verified `checkout.session.completed` event can promote a
   donation to `succeeded`, and only after the charged amount matches what the
   server asked for. Nothing on the request path can mint a paid gift.
4. Refunds are issued by the organization in the **Stripe Dashboard** — the
   restricted key cannot issue them. The webhook updates the platform's records.

| | |
|---|---|
| Platform fee | **0%**, disclosed on every page before checkout |
| Card processing | Stripe's rate (2.9% + 30¢; 2.2% once approved for the nonprofit rate) |
| Fee covered by donor | Optional, pre-checked, clearly labelled |
| Where money settles | The organization's own Stripe account → its bank |

---

## Running before payments are connected

The platform is fully usable before an organization's Stripe credentials exist.
Campaigns, rosters, participant pages, contact outreach, share links, QR codes,
live totals and dashboards all work. Only the donate button is gated:

- **No Stripe key configured** — the donate form reads *"Online donations open
  soon"* and `/api/checkout` answers `503`. Nothing pretends to accept money.
- **Test key on a live site** — allowed only with an explicit
  `ALLOW_TEST_PAYMENTS=true`. The donate form then carries a visible test-mode
  banner and Stripe's test cards work end to end.
- **Live key** — checkout goes live. No other configuration changes.

Email sending is gated the same way: with no provider key, the participant
console explains that texting and share links work now and email opens when the
organization connects a sender.

---

## Before the first real donation

These are not code problems, and they gate a launch.

1. **The organization creates the Stripe key, not the operator.** In the
   organization's Stripe Dashboard → Developers → API keys → *Create restricted
   key* with exactly **Checkout Sessions: Write** and **Payment Intents: Read**.
   The application refuses an unrestricted `sk_` key in every environment and a
   test key in production unless explicitly opted in. Verify the permission set
   using Stripe's own procedure: run the flow in a sandbox with the restricted
   key and read that key's request logs for 403s.
2. **The organization creates the webhook endpoint** pointing at
   `https://<domain>/api/webhooks/stripe` with events
   `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
   `checkout.session.async_payment_failed`, `charge.refunded` and
   `charge.dispute.created`, and provides the signing secret.
3. **Apply for Stripe's nonprofit rate.** Until it is approved, leave
   `NEXT_PUBLIC_STRIPE_FEE_PERCENT=2.9`. The default over-collects the optional
   donor fee slightly rather than under-collecting the organization.
4. **Confirm the organization may solicit.** Most US states require charitable
   solicitation registration unless an exemption applies. If the organization is
   a university club or program, confirm independent solicitation is permitted.
5. **Enter the organization's legal name, EIN and postal address** at
   `/admin/settings`. Receipts print them (IRS Pub. 1771), and **no outreach
   email can be sent until the address is on file** (CAN-SPAM).
6. **Verify the sending domain** with the email provider and publish SPF, DKIM
   and DMARC records. Without them, receipts and invitations land in spam and
   the domain's reputation suffers from the first send.

---

## Quick start

Requires Node 20.12 or newer.

```bash
npm install
cp .env.example .env.local
npm run keys:generate        # paste the three PII_* lines into .env.local
```

**Authentication keys are required to run the application**, even locally —
there is no password fallback by design. Create a Clerk application, copy its
publishable and secret keys into `.env.local`, and add an administrator address
to `BOOTSTRAP_ADMIN_EMAILS`.

Start the bundled database (Postgres compiled to WebAssembly — no Docker, no
install), then the application:

```bash
npm run db:dev               # 127.0.0.1:5433, data persists in .devdb/
npm run db:seed              # creates the organization row
npm run dev
```

Sign in at `/sign-in`. The bootstrap address becomes organization owner on first
sign-in (recorded in the audit log), then `/admin` creates a campaign.

> The bundled database accepts **one connection at a time**. Stop `npm run dev`
> before running another script against it, or point `DATABASE_URL` at a real
> Postgres instance. This applies only to `npm run db:dev`.

With no email provider key, every message is printed to the development console
instead of being sent. With no Redis credentials, rate limits are in-process
(development only — production refuses to start without them). With no blob
storage token, photo uploads fail closed with a clear message.

### Testing payments locally

```bash
stripe listen --forward-to localhost:3000/api/webhooks/stripe
```

Put the printed `whsec_…` in `STRIPE_WEBHOOK_SECRET` and donate with test card
`4242 4242 4242 4242`. The donation stays `pending` until the forwarded webhook
arrives, which is what promotes it and sends the receipt.

### Commands

| | |
|---|---|
| `npm run dev` / `build` / `start` | Next.js |
| `npm run db:dev` | bundled WebAssembly Postgres on :5433 |
| `npm run db:seed` | create the organization row |
| `npm run db:generate` / `db:migrate` / `db:push` | migrations |
| `npm run db:import -- data/<file>.json [--replace]` | load a previous campaign's roster and donations |
| `npm run roster:sync -- --campaign <slug> [--json data/<file>.json]` | pull headshots, numbers, positions and years from a public roster page |
| `npm run keys:generate` | fresh PII encryption and index keys |
| `npm run verify` | full test suite against in-process Postgres |
| `npm run typecheck` / `lint` | |

---

## Configuration

Everything lives in environment variables or the host's secret manager.
`.env.example` documents every key; the groupings that matter:

| Group | Keys | Notes |
|---|---|---|
| Database | `DATABASE_URL` | Connect as the least-privilege `app` role from `scripts/grants.sql`, never as owner |
| Authentication | `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `CLERK_WEBHOOK_SIGNING_SECRET`, `BOOTSTRAP_ADMIN_EMAILS` | |
| Payments | `STRIPE_SECRET_KEY` (**`rk_`**), `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_STRIPE_FEE_PERCENT`, `NEXT_PUBLIC_STRIPE_FEE_FIXED_CENTS`, `ALLOW_TEST_PAYMENTS` | Organization-issued restricted key |
| PII encryption | `PII_ENCRYPTION_KEYS`, `PII_ENCRYPTION_ACTIVE_KEY_ID`, `PII_INDEX_KEY` | Keep the index key in a different scope from `DATABASE_URL` |
| Rate limiting | `UPSTASH_REDIS_REST_URL` / `_TOKEN`, or `KV_REST_API_URL` / `_TOKEN` | Required in production |
| Email | `RESEND_API_KEY`, `EMAIL_FROM`, `RESEND_WEBHOOK_SECRET` | |
| Uploads | `BLOB_READ_WRITE_TOKEN` | |
| Bot protection | `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | Optional; activates when set |
| Site | `NEXT_PUBLIC_SITE_URL`, `APP_ENV` | Falls back to the platform's own deployment URL |
| Bootstrap | `SETUP_TOKEN` | One-time only; see [Deploying](#deploying) |

---

## Architecture

Next.js 16 App Router · TypeScript · Postgres with Drizzle · Clerk · Stripe
Checkout · Resend · Upstash · Vercel Blob · Tailwind 4.

### Routes

| Path | Who | What |
|---|---|---|
| `/` | public | active campaigns |
| `/c/[campaign]` | public | campaign page, live thermometer, roster, donor wall, donate form |
| `/c/[campaign]/[participant]` | public | participant page with attribution (`?ref=`) |
| `/r/[code]` | public | tracked short link → participant page |
| `/qr/[code]` | public | SVG QR code for a share link |
| `/c/**/opengraph-image` | public | generated share card for links in chats and feeds |
| `/thanks` | public | post-checkout confirmation |
| `/unsubscribe/[token]`, `POST /api/unsubscribe/[token]` | public | human and RFC 8058 one-click unsubscribe |
| `/api/checkout` | public, rate-limited | creates the Stripe session |
| `/api/campaigns/[id]/stats`, `/api/participants/[id]/stats` | public, cached | PII-free live numbers |
| `/api/webhooks/stripe` `clerk` `resend` | signed | idempotent event ingestion |
| `/dashboard` | signed in | role router and join-by-code |
| `/dashboard/[participantId]` | owner only | console: link, QR, contacts, family helpers, supporters, profile |
| `/join/[token]` | signed in | accept an invitation (explicit POST) |
| `/admin`, `/admin/campaigns/*`, `/admin/settings`, `/admin/audit` | organization admin | management |
| `/api/admin/campaigns/[id]/export` | organization admin, audited | donor CSV |

### Authorization model

Two kinds of authority, both derived from the session, never from a
client-supplied identifier:

- **Organization membership** (`memberships.role` = owner/admin) authorizes
  campaign and roster management, settings, exports and the audit log.
- **Participant ownership** (`participants.user_id` = session user) authorizes
  profile edits, contacts, helpers and outreach for that one row.

Every server action and route handler calls a guard in `lib/authz.ts` first.
Where a client sends an identifier it is a lookup hint; the `WHERE` clause
carries the session-derived owner. `proxy.ts` handles sessions and headers only
— route protection lives beside the data, because server actions are POSTs to
their page route and can otherwise slip past a matcher.

### Encryption model

`lib/crypto.ts`. Column-level AES-256-GCM for every piece of third-party PII:
donor name, email and note; every imported contact; family helpers; invitation
emails. The column identity is bound as GCM additional authenticated data, so a
ciphertext moved between columns fails to decrypt. Envelopes carry a key id, so
rotation is a background re-encrypt rather than a migration.

Equality lookups (deduplication, suppression, invitation matching) use
HMAC-SHA256 **blind indexes** under a separate key. Participant and administrator
emails on `users` stay plaintext: they are identity, the auth layer queries by
them, and they are not donor data.

Decryption happens in exactly five places: the public donor wall (name and note,
name withheld for anonymous gifts), an owner's own contact list, an owner's own
helper list, the receipt sender, and `lib/queries/admin-donations.ts` — which is
admin-only and audited on every read.

### Outreach pipeline

`lib/outreach.ts` is the only code that emails an imported contact. Every gate
is inside it: the contact belongs to the sender · has an email · has not
unsubscribed · is not on the organization-wide suppression list · was not
mailed in the last 7 days · at most 25 per send · 100 per participant per day ·
list capped at 100 · organization postal address on file. Every message carries
the address, a signed unsubscribe link and a `List-Unsubscribe-Post` header.
Bounces and complaints arrive by webhook and suppress the address
organization-wide.

**Family helpers** (`lib/helpers.ts`) extend reach to a participant's parents.
A participant adds up to four relatives; each receives one share-kit email
containing the participant's own tracked link, a forward-ready note and the QR
code, then spreads it from their own address book. Gifts arriving through that
link are attributed to the helper.

SMS is never sent by the platform. "Text" mints a per-contact tracked link and
opens the participant's own messaging app — no A2P 10DLC registration, no TCPA
sender obligations.

---

## Security

| Requirement | Implementation |
|---|---|
| Managed authentication, no password storage | Clerk (`proxy.ts`, `lib/authz.ts`); only a verified address becomes identity |
| Ownership check on every write | `lib/authz.ts` guards; session-scoped `WHERE` on every mutation |
| Server-side validation | Zod on every action and route |
| Rate limiting | Distributed sliding windows per IP, user and participant; production fails closed without Redis |
| PII encrypted at rest | AES-256-GCM with AAD and blind indexes; IP addresses stored only as monthly-rotating HMACs |
| Never log PII | Action wrapper logs error messages only; the audit writer rejects PII-shaped keys at runtime; webhook payloads are never stored |
| CSRF | Server actions (framework origin check); the only unauthenticated POSTs are checkout (bot-protected, rate-limited) and signed webhooks |
| HTTPS, secure cookies, headers | Nonce-based strict CSP, HSTS preload, `frame-ancestors 'none'`, nosniff, referrer and permissions policies |
| Verified webhooks | Stripe `constructEvent`, Clerk `verifyWebhook`, Resend via Svix; all three on a replay ledger that re-claims failed attempts |
| Secrets in environment only | `.env.example` holds placeholders exclusively |
| Audit log | Append-only (`scripts/grants.sql` revokes UPDATE/DELETE); covers administrator writes, exports and donor-PII views; browsable at `/admin/audit` |
| Restricted payment key | `lib/stripe.ts` refuses `sk_` everywhere and test keys in production unless explicitly opted in |
| Attribution only | No payout code exists. Funds settle to the organization directly. |

A full security review of the codebase found no exploitable vulnerability.

---

## Design decisions

Choices a reviewer or maintainer is most likely to question, with their reasons
and limits.

1. **Blind indexes leak equality.** Anyone holding both the database and
   `PII_INDEX_KEY` can confirm a *guessed* email. Keep the index key out of the
   scope that holds `DATABASE_URL`. There is no equality lookup without this
   tradeoff short of searchable encryption, which is not warranted at this scale.
2. **Encryption keys live in environment variables, not a KMS.** On a managed
   host that means encrypted at rest and exposed only to the runtime. The
   upgrade path is a `KmsKeyProvider` behind the existing `KeyProvider`
   interface: IAM-scoped decrypt with its own audit trail. Nothing else changes.
3. **Participants do not see donor email addresses.** They see name, amount,
   date and note — enough to say thank you. Widening this is a one-line change
   in `listDonorsForParticipant`, but it multiplies the breach surface by the
   size of the roster. Administrators see addresses, audited.
4. **Anonymous donors are anonymous to the participant too.** The administrator
   export shows the real name so the organization can acknowledge the gift
   privately.
5. **Partially refunded gifts drop out of public totals.** Conservative: totals
   never overstate. The refunded amount is recorded for reconciliation.
6. **The webhook trusts Stripe's `amount_total`** and cross-checks it against
   the server-computed pending row. A mismatch marks the donation failed. The
   client's arithmetic is never consulted.
7. **A pending card checkout is not a supporter.** Abandoned checkouts stay
   hidden; pending is shown only for bank debits, which genuinely take days.
8. **Uploads are validated by magic bytes**, not the declared content type. SVG
   is refused because it can carry script. `img-src` allows only the blob store
   and the authentication provider's CDN.
9. **Bot protection is optional but expected.** It activates when both Turnstile
   keys are set. Enable it before going live — public donate forms attract
   card-testing — and enable Stripe Radar on the organization's account.
10. **Outreach limits are constants** in `lib/outreach.ts` and `lib/helpers.ts`:
    100 contacts and 4 helpers per participant, 25 per send, 100 sends per day,
    7-day resend cooldown. Raise them only alongside sending-domain reputation.
11. **Every email escapes interpolated values** (`lib/html.ts`). Receipt,
    invitation, outreach and share-kit templates are all covered.
12. **Migrations run at build time.** The schema is always what the deployed
    code expects, which matters when database credentials are host-held secrets
    that no operator machine can reach.

---

## Deploying

Built for Vercel; any Node 20 host works with `APP_ENV=production`.

1. Import the repository. Set every variable from `.env.example`. Generate
   **fresh** encryption keys for production — never reuse development keys.
2. Provision Postgres, Redis and blob storage. Schema migrations run during the
   build (`build:vercel` = `drizzle-kit migrate && next build`), so no manual
   migration step is needed.
3. As the database owner, run `scripts/grants.sql` to create the least-privilege
   `app` role and point `DATABASE_URL` at it.
4. Configure the authentication provider's webhook at `/api/webhooks/clerk`
   (`user.created`, `user.updated`, `user.deleted`) and copy the signing secret.
5. Have the organization create the restricted payment key and webhook endpoint
   (see [Before the first real donation](#before-the-first-real-donation)).
6. Verify the sending domain and configure the email webhook at
   `/api/webhooks/resend` (`email.delivered`, `email.bounced`, `email.complained`).
7. Set `NEXT_PUBLIC_SITE_URL` to the real domain. Share links and QR codes are
   built from it.
8. Enable bot protection and Stripe Radar.
9. Make one real small donation end to end and confirm the receipt, the audit
   row and the settlement in the organization's Stripe balance — before inviting
   a single participant.

### Bootstrapping a fresh deployment

Where database credentials are host-held secrets that cannot be pulled to a
workstation, the first data load happens through a one-time endpoint. Set
`SETUP_TOKEN` (48 random bytes) in the project's environment, deploy, then
`POST /api/setup` with `Authorization: Bearer <token>` and a body of
`{"op":"seed","name":"…"}` followed by `{"op":"import","payload":<roster json>}`.

**Remove `SETUP_TOKEN` immediately afterwards and redeploy** — while it is unset
the route returns 404.

---

## Importing a previous campaign

`npm run db:import -- data/<file>.json` loads a roster and its donation history.
Each participant becomes a row owned by a placeholder account (a reserved
`.invalid` address that cannot sign in); the administrator roster marks them
**unclaimed** and offers a claim invitation. When the real person accepts, the
existing row — page, links, totals — moves to their account rather than a
duplicate being created.

Imported gifts are recorded with `source = import`: they count toward the total
and are excluded from processing-fee estimates, since they never went through
this platform's payment account. If the file carries expected per-participant
counts and totals, they are reconciled before anything is written and a mismatch
aborts with the specific discrepancies.

Keep data files under `data/` — it is gitignored, because they contain donor names.

---

## Branding and roster photos

`lib/brand.ts` names the team and points at `public/brand/` (logo lockup, square
mark, favicon via `app/icon.png`). The organization row holds the legal identity
used on receipts; branding is separate and cosmetic.

`npm run roster:sync` reads a public roster page (`ROSTER_URL`), matches players
to participants by name — exact, or same surname with a first-name prefix such
as Matt/Matthew — and stores headshots under `public/roster/<slug>.jpg`, served
first-party so nothing hotlinks the source and the CSP stays `img-src 'self'`.
A photo a participant uploaded themselves is never overwritten. The parser is
pure and unit-tested (`lib/roster-scrape.ts`).

Photos and logos belong to the organization; confirm permission before publishing.

---

## Running a campaign

The administrator roster is the thing to watch. **Contacts loaded but zero
messages sent** is the number to chase — that participant is one reminder away
from their entire total. The dashboard offers a one-click nudge to everyone who
has not yet shared.

Two things move the number more than anything technical:

- **Specific, itemized goals.** "Ice time is $340 an hour and the season needs
  60 hours" outperforms "support our program."
- **Participants' own stories, in their own words.** A generic team page raises a
  fraction of what personal pages do.

The highest-leverage feature is family helpers: a parent's network is larger
than a student's, and a forwarded note from a relative converts better than any
message from the platform.

---

## Testing

`npm run verify` runs 343 checks against an in-process Postgres with ephemeral
keys and no network. Coverage includes: the encryption envelope, AAD binding and
key rotation; blind-index normalization; IP hashing; the audit PII guard; rate
limiter semantics including batch cost; every schema constraint; campaign,
participant and donation queries including draft visibility and status
filtering; upload sniffing; click-privacy guarantees; CSV import parsing and
export formula neutralization; unsubscribe tokens; the full outreach gate set;
family helper caps, cooldowns and suppression; the payment webhook state machine
(paid, bank-debit delayed, amount mismatch, partial and full refund, dispute,
replay); webhook signature verification and ledger retry semantics for both
payment and email providers; donor-wall anonymity; administrator financials; and
the audit trail.

It does **not** exercise authentication-gated pages (they require live
authentication keys) or live payment and email calls. Those are covered by the
end-to-end donation in the deployment checklist.

---

## Limitations

- `npm audit` reports moderate advisories in a development-only build
  dependency. It does not ship in the production bundle.
- No administrative interface for creating a second organization; the schema
  supports it, the UI assumes one.
- No receipt re-send button. A failed receipt is logged and can be re-sent by
  hand from the audit trail and the payment record.
- Photo uploads require blob storage; there is no alternate storage adapter.
- The bundled development database accepts one connection at a time.
