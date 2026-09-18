import {
  pgTable,
  text,
  integer,
  boolean,
  timestamp,
  uuid,
  index,
  uniqueIndex,
  pgEnum,
} from "drizzle-orm/pg-core";

export const roleEnum = pgEnum("role", ["admin", "player"]);
export const donationStatusEnum = pgEnum("donation_status", [
  "pending",
  "succeeded",
  "refunded",
]);
export const channelEnum = pgEnum("channel", [
  "sms",
  "email",
  "social",
  "direct",
]);

/** One fundraiser. Kept as a table so next season is a new row, not a redeploy. */
export const campaigns = pgTable("campaigns", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  tagline: text("tagline"),
  story: text("story"),
  goalCents: integer("goal_cents").notNull().default(0),
  heroImageUrl: text("hero_image_url"),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull().defaultNow(),
  endsAt: timestamp("ends_at", { withTimezone: true }),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Coaches and players. A row here is an invitation: login is allowed only
 *  for emails that already exist, so the sign-in form cannot create accounts. */
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  role: roleEnum("role").notNull().default("player"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** A user's entry in one campaign — their public page and personal goal. */
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
    photoUrl: text("photo_url"),
    bio: text("bio"),
    goalCents: integer("goal_cents").notNull().default(0),
    jerseyNumber: text("jersey_number"),
    position: text("position"),
    gradYear: text("grad_year"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("participants_campaign_slug_idx").on(t.campaignId, t.slug),
    uniqueIndex("participants_campaign_user_idx").on(t.campaignId, t.userId),
  ],
);

/** A player's private address book. Never shown publicly, never sold, never
 *  bulk-mailed by us — it exists to generate prefilled links the player sends. */
export const contacts = pgTable(
  "contacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    participantId: uuid("participant_id")
      .notNull()
      .references(() => participants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    email: text("email"),
    phone: text("phone"),
    note: text("note"),
    lastContactedAt: timestamp("last_contacted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("contacts_participant_idx").on(t.participantId)],
);

/** Short tracked URL. One per contact per player, plus one generic per channel. */
export const shareLinks = pgTable(
  "share_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull().unique(),
    participantId: uuid("participant_id")
      .notNull()
      .references(() => participants.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id").references(() => contacts.id, {
      onDelete: "set null",
    }),
    channel: channelEnum("channel").notNull().default("direct"),
    clickCount: integer("click_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("share_links_participant_idx").on(t.participantId)],
);

/** Records that a player actually opened a prefilled message for a contact. */
export const outreach = pgTable(
  "outreach",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    channel: channelEnum("channel").notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("outreach_contact_idx").on(t.contactId)],
);

export const linkEvents = pgTable(
  "link_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shareLinkId: uuid("share_link_id")
      .notNull()
      .references(() => shareLinks.id, { onDelete: "cascade" }),
    referer: text("referer"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("link_events_share_link_idx").on(t.shareLinkId)],
);

/**
 * amountCents      what the team is credited with (drives the thermometer)
 * feeCoveredCents  the extra the donor chose to add to absorb Stripe's cut
 * totalChargedCents what the card was actually charged = amount + feeCovered
 */
export const donations = pgTable(
  "donations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    participantId: uuid("participant_id").references(() => participants.id, {
      onDelete: "set null",
    }),
    shareLinkId: uuid("share_link_id").references(() => shareLinks.id, {
      onDelete: "set null",
    }),
    amountCents: integer("amount_cents").notNull(),
    feeCoveredCents: integer("fee_covered_cents").notNull().default(0),
    totalChargedCents: integer("total_charged_cents").notNull(),
    donorName: text("donor_name"),
    donorEmail: text("donor_email"),
    message: text("message"),
    isAnonymous: boolean("is_anonymous").notNull().default(false),
    status: donationStatusEnum("status").notNull().default("pending"),
    stripeSessionId: text("stripe_session_id").unique(),
    stripePaymentIntentId: text("stripe_payment_intent_id"),
    receiptSentAt: timestamp("receipt_sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("donations_campaign_idx").on(t.campaignId),
    index("donations_participant_idx").on(t.participantId),
    index("donations_status_idx").on(t.status),
  ],
);

/** Single-use magic-link tokens. Only the SHA-256 hash is stored. */
export const authTokens = pgTable(
  "auth_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("auth_tokens_email_idx").on(t.email)],
);

export type Campaign = typeof campaigns.$inferSelect;
export type User = typeof users.$inferSelect;
export type Participant = typeof participants.$inferSelect;
export type Contact = typeof contacts.$inferSelect;
export type ShareLink = typeof shareLinks.$inferSelect;
export type Donation = typeof donations.$inferSelect;
