/**
 * Conventions
 *  - Every id is a uuid. Every money value is integer cents.
 *  - Columns ending in `Ciphertext` hold an AES-256-GCM envelope from lib/crypto.
 *    Columns ending in `BlindIndex` hold an HMAC of the normalized plaintext and
 *    exist only so equality lookups (dedupe, suppression) work without decrypting.
 *  - Participant and admin emails on `users` are identity, not donor PII, and
 *    stay plaintext because the auth layer queries by them. Everything a donor
 *    or a participant's contact hands us is encrypted.
 *  - Nothing here ever holds a Stripe secret, a webhook payload, or a raw IP.
 */
import {
  pgTable,
  pgEnum,
  text,
  integer,
  boolean,
  timestamp,
  uuid,
  jsonb,
  char,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

// ---------------------------------------------------------------- enums

export const membershipRole = pgEnum("membership_role", ["owner", "admin"]);
export const campaignStatus = pgEnum("campaign_status", ["draft", "active", "closed"]);
export const participantStatus = pgEnum("participant_status", ["invited", "active", "removed"]);
export const shareMedium = pgEnum("share_medium", ["personal", "qr", "email_invite", "sms", "social"]);
export const contactSource = pgEnum("contact_source", ["csv", "manual"]);
export const emailInviteStatus = pgEnum("email_invite_status", [
  "queued",
  "sent",
  "delivered",
  "bounced",
  "complained",
  "failed",
]);
export const outreachChannel = pgEnum("outreach_channel", ["sms", "email_manual", "copy_link"]);
export const suppressionReason = pgEnum("suppression_reason", [
  "unsubscribed",
  "bounced",
  "complained",
  "manual",
]);
export const donationStatus = pgEnum("donation_status", [
  "pending",
  "succeeded",
  "refunded",
  "partially_refunded",
  "failed",
  "disputed",
]);
export const webhookStatus = pgEnum("webhook_status", ["received", "processed", "failed", "ignored"]);

// ---------------------------------------------------------------- identity

/** The booster organization. Single row in v1; the column exists so a second
 *  program can be added without a migration. Stripe secrets are NOT here. */
export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  legalName: text("legal_name"),
  ein: text("ein"),
  addressLine1: text("address_line1"),
  addressLine2: text("address_line2"),
  city: text("city"),
  state: text("state"),
  postalCode: text("postal_code"),
  /** Publishable keys are public by design; safe to store. */
  stripePublishableKey: text("stripe_publishable_key"),
  /** Disclosed pre-checkout. Held at 0: a direct-to-org integration cannot
   *  collect a platform fee without Stripe Connect. */
  platformFeeBps: integer("platform_fee_bps").notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** Mirror of the Clerk user. Clerk is the source of truth for identity; this
 *  row exists so the rest of the schema can hold a stable uuid foreign key. */
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clerkUserId: text("clerk_user_id").notNull().unique(),
    /** Lower-cased on write. Plaintext: identity, not donor PII. */
    email: text("email").notNull().unique(),
    name: text("name"),
    imageUrl: text("image_url"),
    /** Soft delete keeps donation attribution intact when a Clerk user is removed. */
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("users_email_idx").on(t.email)],
);

/** Org-level authority. Participants are NOT memberships; they live per-campaign. */
export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: membershipRole("role").notNull().default("admin"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("memberships_org_user_idx").on(t.orgId, t.userId),
    index("memberships_user_idx").on(t.userId),
  ],
);

// ---------------------------------------------------------------- campaigns

export const campaigns = pgTable(
  "campaigns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    goalCents: integer("goal_cents").notNull().default(0),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull().defaultNow(),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    status: campaignStatus("status").notNull().default("draft"),
    heroImageUrl: text("hero_image_url"),
    /** Snapshot of the org's rate at creation so historical totals stay honest. */
    platformFeeBps: integer("platform_fee_bps").notNull().default(0),
    allowFeeCover: boolean("allow_fee_cover").notNull().default(true),
    /** Short code a participant enters to self-join. Rotatable. */
    joinCode: text("join_code").notNull().unique(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("campaigns_org_slug_idx").on(t.orgId, t.slug),
    index("campaigns_org_status_idx").on(t.orgId, t.status),
  ],
);

export const participants = pgTable(
  "participants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    displayName: text("display_name").notNull(),
    bio: text("bio"),
    photoUrl: text("photo_url"),
    goalCents: integer("goal_cents").notNull().default(0),
    teamRole: text("team_role"),
    classYear: text("class_year"),
    status: participantStatus("status").notNull().default("active"),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("participants_campaign_user_idx").on(t.campaignId, t.userId),
    uniqueIndex("participants_campaign_slug_idx").on(t.campaignId, t.slug),
    index("participants_user_idx").on(t.userId),
  ],
);

/** Admin-issued invitation. Matched to the signing-in user by blind index, so
 *  the invite email never needs decrypting to complete onboarding. */
export const participantInvites = pgTable(
  "participant_invites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    emailCiphertext: text("email_ciphertext").notNull(),
    emailBlindIndex: text("email_blind_index").notNull(),
    /** sha256 of the raw token; the raw token appears only in the invite email. */
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    acceptedUserId: uuid("accepted_user_id").references(() => users.id, { onDelete: "set null" }),
    invitedBy: uuid("invited_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("participant_invites_campaign_email_idx").on(t.campaignId, t.emailBlindIndex)],
);

// ---------------------------------------------------------------- sharing

export const shareLinks = pgTable(
  "share_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull().unique(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    participantId: uuid("participant_id")
      .notNull()
      .references(() => participants.id, { onDelete: "cascade" }),
    medium: shareMedium("medium").notNull().default("personal"),
    /** Set when the link was minted for one specific contact. */
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    clickCount: integer("click_count").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index("share_links_participant_idx").on(t.participantId)],
);

/** Inbound clicks. IPs are HMAC'd with a monthly-rotating salt, never stored raw. */
export const linkEvents = pgTable(
  "link_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shareLinkId: uuid("share_link_id")
      .notNull()
      .references(() => shareLinks.id, { onDelete: "cascade" }),
    ipHash: text("ip_hash"),
    /** Browser family only ("Mobile Safari"), not the raw UA string. */
    uaFamily: text("ua_family"),
    /** Host only, never the full referring URL. */
    refererHost: text("referer_host"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("link_events_share_link_idx").on(t.shareLinkId)],
);

// ---------------------------------------------------------------- outreach

/** A participant's private imported list. Third-party PII: fully encrypted. */
export const contacts = pgTable(
  "contacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    participantId: uuid("participant_id")
      .notNull()
      .references(() => participants.id, { onDelete: "cascade" }),
    nameCiphertext: text("name_ciphertext").notNull(),
    emailCiphertext: text("email_ciphertext"),
    phoneCiphertext: text("phone_ciphertext"),
    emailBlindIndex: text("email_blind_index"),
    phoneBlindIndex: text("phone_blind_index"),
    source: contactSource("source").notNull().default("csv"),
    unsubscribedAt: timestamp("unsubscribed_at", { withTimezone: true }),
    lastInvitedAt: timestamp("last_invited_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index("contacts_participant_idx").on(t.participantId),
    // Postgres treats NULLs as distinct in unique indexes, so phone-only rows coexist.
    uniqueIndex("contacts_participant_email_idx").on(t.participantId, t.emailBlindIndex),
  ],
);

/** Provenance for every CSV upload — who imported what, when, and that they attested consent. */
export const contactImports = pgTable(
  "contact_imports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    participantId: uuid("participant_id")
      .notNull()
      .references(() => participants.id, { onDelete: "cascade" }),
    originalFilename: text("original_filename"),
    byteSize: integer("byte_size").notNull(),
    rowCount: integer("row_count").notNull(),
    importedCount: integer("imported_count").notNull(),
    skippedCount: integer("skipped_count").notNull(),
    attestedConsent: boolean("attested_consent").notNull(),
    errorSummary: text("error_summary"),
    createdAt: createdAt(),
  },
  (t) => [index("contact_imports_participant_idx").on(t.participantId)],
);

/** Platform-sent templated email. One row per send, tracked through delivery. */
export const emailInvites = pgTable(
  "email_invites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    participantId: uuid("participant_id")
      .notNull()
      .references(() => participants.id, { onDelete: "cascade" }),
    shareLinkId: uuid("share_link_id").references(() => shareLinks.id, { onDelete: "set null" }),
    providerMessageId: text("provider_message_id"),
    status: emailInviteStatus("status").notNull().default("queued"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index("email_invites_contact_idx").on(t.contactId),
    index("email_invites_participant_idx").on(t.participantId),
  ],
);

/** Participant-initiated actions: tapping "Text", opening a manual mailto, copying the link. */
export const outreachEvents = pgTable(
  "outreach_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    participantId: uuid("participant_id")
      .notNull()
      .references(() => participants.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    channel: outreachChannel("channel").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("outreach_events_participant_idx").on(t.participantId)],
);

/** Org-wide do-not-email. Checked before every platform send. CAN-SPAM requires it. */
export const suppressions = pgTable(
  "suppressions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    emailBlindIndex: text("email_blind_index").notNull(),
    reason: suppressionReason("reason").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("suppressions_org_email_idx").on(t.orgId, t.emailBlindIndex)],
);

// ---------------------------------------------------------------- money

/**
 * Every money column is written from the Stripe webhook, never from the client.
 *   grossAmountCents      what the card was charged
 *   designatedAmountCents credited to the campaign / participant (drives totals)
 *   feeCoveredCents       donor's optional processing offset
 *   platformFeeCents      disclosed platform fee — 0 in v1
 */
export const donations = pgTable(
  "donations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    participantId: uuid("participant_id").references(() => participants.id, { onDelete: "set null" }),
    shareLinkId: uuid("share_link_id").references(() => shareLinks.id, { onDelete: "set null" }),

    grossAmountCents: integer("gross_amount_cents").notNull(),
    designatedAmountCents: integer("designated_amount_cents").notNull(),
    feeCoveredCents: integer("fee_covered_cents").notNull().default(0),
    platformFeeCents: integer("platform_fee_cents").notNull().default(0),
    refundedAmountCents: integer("refunded_amount_cents").notNull().default(0),
    currency: char("currency", { length: 3 }).notNull().default("usd"),

    donorNameCiphertext: text("donor_name_ciphertext"),
    donorEmailCiphertext: text("donor_email_ciphertext"),
    donorEmailBlindIndex: text("donor_email_blind_index"),
    /** Shown on the public wall, but donor-authored free text — encrypted like the rest. */
    messageCiphertext: text("message_ciphertext"),
    isAnonymous: boolean("is_anonymous").notNull().default(false),

    status: donationStatus("status").notNull().default("pending"),
    /** "card" | "us_bank_account" | … — reporting only, not PII. */
    paymentMethodType: text("payment_method_type"),

    stripeCheckoutSessionId: text("stripe_checkout_session_id").unique(),
    stripePaymentIntentId: text("stripe_payment_intent_id").unique(),
    stripeChargeId: text("stripe_charge_id"),

    receiptSentAt: timestamp("receipt_sent_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("donations_campaign_status_idx").on(t.campaignId, t.status),
    index("donations_participant_idx").on(t.participantId),
    index("donations_donor_email_idx").on(t.donorEmailBlindIndex),
  ],
);

// ---------------------------------------------------------------- operations

/** Idempotency ledger for inbound webhooks. Stripe and Clerk both deliver at
 *  least once. The payload is deliberately not stored — it contains PII. */
export const webhookEvents = pgTable(
  "webhook_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    provider: text("provider").notNull(),
    eventId: text("event_id").notNull(),
    type: text("type").notNull(),
    status: webhookStatus("status").notNull().default("received"),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    errorMessage: text("error_message"),
  },
  (t) => [uniqueIndex("webhook_events_provider_event_idx").on(t.provider, t.eventId)],
);

/**
 * Append-only. The application's database role must be granted INSERT and
 * SELECT on this table and nothing else — see scripts/grants.sql. `metadata`
 * holds ids and field names, never values; lib/audit rejects PII-shaped keys.
 */
export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").references(() => organizations.id, { onDelete: "set null" }),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    actorIpHash: text("actor_ip_hash"),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id"),
    metadata: jsonb("metadata").$type<Record<string, string | number | boolean | null>>(),
    createdAt: createdAt(),
  },
  (t) => [
    index("audit_logs_org_created_idx").on(t.orgId, t.createdAt),
    index("audit_logs_actor_idx").on(t.actorUserId),
  ],
);

// ---------------------------------------------------------------- types

export type Organization = typeof organizations.$inferSelect;
export type User = typeof users.$inferSelect;
export type Membership = typeof memberships.$inferSelect;
export type Campaign = typeof campaigns.$inferSelect;
export type Participant = typeof participants.$inferSelect;
export type ParticipantInvite = typeof participantInvites.$inferSelect;
export type ShareLink = typeof shareLinks.$inferSelect;
export type Contact = typeof contacts.$inferSelect;
export type Donation = typeof donations.$inferSelect;
export type AuditLog = typeof auditLogs.$inferSelect;
