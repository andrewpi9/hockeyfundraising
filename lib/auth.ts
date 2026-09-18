import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { eq, and, isNull, gt } from "drizzle-orm";
import { db } from "./db";
import { users, authTokens, participants } from "./db/schema";

const COOKIE = "session";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

function secret(): Uint8Array {
  const raw = process.env.SESSION_SECRET;
  if (!raw || raw.length < 16) {
    throw new Error("SESSION_SECRET must be set to at least 16 characters.");
  }
  return new TextEncoder().encode(raw);
}

export type Session = { userId: string; email: string; role: "admin" | "player" };

export async function createSession(session: Session) {
  const jwt = await new SignJWT({ email: session.email, role: session.role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(session.userId)
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_SECONDS}s`)
    .sign(secret());

  (await cookies()).set(COOKIE, jwt, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
}

export async function destroySession() {
  (await cookies()).delete(COOKIE);
}

export async function getSession(): Promise<Session | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    if (!payload.sub) return null;
    return {
      userId: payload.sub,
      email: String(payload.email),
      role: payload.role === "admin" ? "admin" : "player",
    };
  } catch {
    return null;
  }
}

/** Throws rather than redirecting so callers choose the response. */
export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) throw new Error("UNAUTHENTICATED");
  return session;
}

export async function requireAdmin(): Promise<Session> {
  const session = await requireSession();
  if (session.role !== "admin") throw new Error("FORBIDDEN");
  return session;
}

/** The signed-in player's participant row for the active campaign. */
export async function currentParticipant(campaignId: string) {
  const session = await getSession();
  if (!session) return null;
  const [row] = await db
    .select()
    .from(participants)
    .where(
      and(
        eq(participants.userId, session.userId),
        eq(participants.campaignId, campaignId),
      ),
    )
    .limit(1);
  return row ?? null;
}

const hash = (token: string) => createHash("sha256").update(token).digest("hex");

/**
 * Issues a single-use token for an email that already belongs to a user.
 * Returns null for unknown emails so the sign-in form cannot be used to
 * enumerate who is on the team.
 */
export async function issueMagicToken(email: string): Promise<string | null> {
  const normalized = email.trim().toLowerCase();
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.email, normalized))
    .limit(1);
  if (!user) return null;

  const token = randomBytes(32).toString("base64url");
  await db.insert(authTokens).values({
    email: normalized,
    tokenHash: hash(token),
    expiresAt: new Date(Date.now() + 15 * 60 * 1000),
  });
  return token;
}

export async function consumeMagicToken(token: string): Promise<Session | null> {
  const candidate = hash(token);

  const [row] = await db
    .select()
    .from(authTokens)
    .where(
      and(
        eq(authTokens.tokenHash, candidate),
        isNull(authTokens.usedAt),
        gt(authTokens.expiresAt, new Date()),
      ),
    )
    .limit(1);
  if (!row) return null;

  // Constant-time compare on the hash, so a partial-match timing signal on the
  // indexed lookup cannot be used to grind out a valid token.
  const a = Buffer.from(row.tokenHash, "hex");
  const b = Buffer.from(candidate, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  // Mark used first, and only for a row still unused, so two clicks on the
  // same link cannot both mint a session.
  const claimed = await db
    .update(authTokens)
    .set({ usedAt: new Date() })
    .where(and(eq(authTokens.id, row.id), isNull(authTokens.usedAt)))
    .returning({ id: authTokens.id });
  if (claimed.length === 0) return null;

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.email, row.email))
    .limit(1);
  if (!user) return null;

  return { userId: user.id, email: user.email, role: user.role };
}
