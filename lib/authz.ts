/**
 * Authorization guards. Every Server Action and every route handler that reads
 * or writes protected data calls one of these FIRST, and derives the acting
 * user from the Clerk session — never from a client-supplied id.
 *
 * Clerk's own guidance (and Next.js 16's) is that proxy.ts is not where routes
 * get protected; the check belongs beside the data access. That is this file.
 */
import { auth, currentUser } from "@clerk/nextjs/server";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "./db";
import {
  users,
  memberships,
  organizations,
  campaigns,
  participants,
  type User,
  type Membership,
  type Campaign,
  type Participant,
  type Organization,
} from "./db/schema";
import { audit } from "./audit";
import { normalizeEmail } from "./crypto";

export class AuthError extends Error {
  constructor(public readonly code: "UNAUTHENTICATED" | "FORBIDDEN", message?: string) {
    super(message ?? code);
    this.name = "AuthError";
  }
}

const ADMIN_ROLES: Membership["role"][] = ["owner", "admin"];

// ---------------------------------------------------------------- identity

export async function upsertUserFromClerk(input: {
  clerkUserId: string;
  email: string;
  name: string | null;
  imageUrl: string | null;
}): Promise<User> {
  const email = normalizeEmail(input.email);
  const [row] = await db
    .insert(users)
    .values({ clerkUserId: input.clerkUserId, email, name: input.name, imageUrl: input.imageUrl })
    .onConflictDoUpdate({
      target: users.clerkUserId,
      set: { email, name: input.name, imageUrl: input.imageUrl, deletedAt: null, updatedAt: sql`now()` },
    })
    .returning();
  return row!;
}

export async function softDeleteUserFromClerk(clerkUserId: string): Promise<void> {
  await db.update(users).set({ deletedAt: sql`now()` }).where(eq(users.clerkUserId, clerkUserId));
}

/**
 * Resolves the Clerk session to our users row, creating it on first sight if
 * the sync webhook has not landed yet. Returns null when signed out.
 */
export async function optionalUser(): Promise<User | null> {
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) return null;

  const [existing] = await db
    .select()
    .from(users)
    .where(and(eq(users.clerkUserId, clerkUserId), isNull(users.deletedAt)))
    .limit(1);

  if (existing) {
    // Touch at most hourly; a write per request is wasteful.
    if (!existing.lastSeenAt || Date.now() - existing.lastSeenAt.getTime() > 3_600_000) {
      await db.update(users).set({ lastSeenAt: sql`now()` }).where(eq(users.id, existing.id));
    }
    return existing;
  }

  const cu = await currentUser();
  if (!cu) return null;
  // Only a verified address may become identity; an unverified one could be anyone's.
  const verified = cu.emailAddresses.filter((e) => e.verification?.status === "verified");
  const primary = verified.find((e) => e.id === cu.primaryEmailAddressId)?.emailAddress ?? verified[0]?.emailAddress;
  if (!primary) throw new AuthError("UNAUTHENTICATED", "Clerk user has no verified email address");

  const user = await upsertUserFromClerk({
    clerkUserId,
    email: primary,
    name: [cu.firstName, cu.lastName].filter(Boolean).join(" ") || null,
    imageUrl: cu.imageUrl ?? null,
  });
  await maybeBootstrapAdmin(user);
  return user;
}

export async function requireUser(): Promise<User> {
  const user = await optionalUser();
  if (!user) throw new AuthError("UNAUTHENTICATED");
  return user;
}

/**
 * First-admin bootstrap. BOOTSTRAP_ADMIN_EMAILS is a comma-separated allowlist;
 * a matching user signing in for the first time is granted owner on the org.
 * Audited, and a no-op once a membership exists.
 */
async function maybeBootstrapAdmin(user: User): Promise<void> {
  const allow = (process.env.BOOTSTRAP_ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => normalizeEmail(e))
    .filter(Boolean);
  if (!allow.includes(user.email)) return;

  const [org] = await db.select().from(organizations).limit(1);
  if (!org) return;

  const [existing] = await db
    .select({ id: memberships.id })
    .from(memberships)
    .where(and(eq(memberships.orgId, org.id), eq(memberships.userId, user.id)))
    .limit(1);
  if (existing) return;

  await db.insert(memberships).values({ orgId: org.id, userId: user.id, role: "owner" });
  await audit({
    action: "auth.bootstrap_admin",
    targetType: "membership",
    targetId: user.id,
    orgId: org.id,
    actorUserId: user.id,
  });
}

// ---------------------------------------------------------------- org / campaign authority

export async function membershipFor(userId: string, orgId: string): Promise<Membership | null> {
  const [m] = await db
    .select()
    .from(memberships)
    .where(and(eq(memberships.userId, userId), eq(memberships.orgId, orgId)))
    .limit(1);
  return m ?? null;
}

export async function requireOrgRole(
  orgId: string,
  roles: Membership["role"][] = ADMIN_ROLES,
): Promise<{ user: User; membership: Membership }> {
  const user = await requireUser();
  const membership = await membershipFor(user.id, orgId);
  if (!membership || !roles.includes(membership.role)) throw new AuthError("FORBIDDEN");
  return { user, membership };
}

/** v1 is single-org: the signed-in user's admin membership, wherever it is. */
export async function requireAnyOrgAdmin(): Promise<{
  user: User;
  membership: Membership;
  org: Organization;
}> {
  const user = await requireUser();
  const [row] = await db
    .select({ membership: memberships, org: organizations })
    .from(memberships)
    .innerJoin(organizations, eq(memberships.orgId, organizations.id))
    .where(eq(memberships.userId, user.id))
    .limit(1);
  if (!row || !ADMIN_ROLES.includes(row.membership.role)) throw new AuthError("FORBIDDEN");
  return { user, membership: row.membership, org: row.org };
}

export async function requireCampaignAdmin(
  campaignId: string,
): Promise<{ user: User; membership: Membership; campaign: Campaign }> {
  const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId)).limit(1);
  if (!campaign) throw new AuthError("FORBIDDEN");
  const { user, membership } = await requireOrgRole(campaign.orgId);
  return { user, membership, campaign };
}

// ---------------------------------------------------------------- participant ownership

/**
 * The participant row must belong to the session user. The id the client sent
 * is only a lookup hint — the user id in the WHERE clause is what authorizes.
 */
export async function requireParticipantOwner(
  participantId: string,
): Promise<{ user: User; participant: Participant }> {
  const user = await requireUser();
  const [participant] = await db
    .select()
    .from(participants)
    .where(
      and(
        eq(participants.id, participantId),
        eq(participants.userId, user.id),
        eq(participants.status, "active"),
      ),
    )
    .limit(1);
  if (!participant) throw new AuthError("FORBIDDEN");
  return { user, participant };
}

/** Maps an AuthError to a Response for route handlers; rethrows anything else. */
export function authErrorResponse(err: unknown): Response {
  if (err instanceof AuthError) {
    return Response.json(
      { error: err.code === "UNAUTHENTICATED" ? "Sign in required." : "Not allowed." },
      { status: err.code === "UNAUTHENTICATED" ? 401 : 403 },
    );
  }
  throw err;
}
