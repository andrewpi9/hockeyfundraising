import { createHash, randomBytes } from "node:crypto";

/** 256-bit single-use token. Only its hash is stored; the raw value goes in the email. */
export const inviteToken = () => randomBytes(32).toString("base64url");
export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
export const INVITE_TTL_MS = 14 * 86_400_000;
