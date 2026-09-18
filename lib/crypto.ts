/**
 * Column-level encryption for donor and contact PII.
 *
 * Envelope:  v1.<keyId>.<iv b64url>.<ciphertext||tag b64url>
 *
 *  - AES-256-GCM. The 16-byte auth tag is appended to the ciphertext.
 *  - `context` is bound as GCM additional authenticated data and MUST be the
 *    column identity (e.g. "donations.donor_email"). An attacker with write
 *    access to the database cannot move a ciphertext between columns — it
 *    fails authentication on read.
 *  - `keyId` selects among PII_ENCRYPTION_KEYS so rotation is a new key plus a
 *    background re-encrypt, never a big-bang migration.
 *  - Blind indexes are HMAC-SHA256 under a SEPARATE key so a leak of one key
 *    does not compromise both confidentiality and lookups.
 *
 * Known tradeoff: a blind index leaks equality. Someone holding both the
 * database and PII_INDEX_KEY can confirm a guessed email. Keep the index key
 * in a scope the database credential does not share.
 */
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;
const VERSION = "v1";

export interface KeyProvider {
  activeKeyId(): string;
  encryptionKey(keyId: string): Buffer;
  indexKey(): Buffer;
}

function decodeKey(name: string, raw: string | undefined): Buffer {
  if (!raw) throw new Error(`${name} is not set. Run: npm run keys:generate`);
  const buf = Buffer.from(raw, "base64");
  if (buf.length !== KEY_BYTES) {
    throw new Error(`${name} must decode to exactly ${KEY_BYTES} bytes (got ${buf.length}).`);
  }
  return buf;
}

/**
 * Keys from environment variables. On Vercel these are encrypted at rest and
 * exposed only to the function runtime, which is adequate for v1. The upgrade
 * path is a KmsKeyProvider that fetches data keys from AWS/GCP KMS under an
 * IAM-scoped decrypt permission with its own audit trail — drop it in via
 * setKeyProvider(); nothing else changes.
 */
export class EnvKeyProvider implements KeyProvider {
  private readonly keys = new Map<string, Buffer>();
  private readonly active: string;
  private readonly index: Buffer;

  constructor(env: Record<string, string | undefined> = process.env) {
    const raw = env.PII_ENCRYPTION_KEYS;
    if (!raw) throw new Error("PII_ENCRYPTION_KEYS is not set. Run: npm run keys:generate");

    let parsed: Record<string, string>;
    try {
      parsed = JSON.parse(raw) as Record<string, string>;
    } catch {
      throw new Error('PII_ENCRYPTION_KEYS must be JSON like {"k1":"<base64>"}');
    }
    for (const [id, value] of Object.entries(parsed)) {
      if (!/^[a-z0-9_-]{1,32}$/i.test(id)) throw new Error(`Bad key id "${id}"`);
      this.keys.set(id, decodeKey(`PII_ENCRYPTION_KEYS[${id}]`, value));
    }

    this.active = env.PII_ENCRYPTION_ACTIVE_KEY_ID ?? "";
    if (!this.keys.has(this.active)) {
      throw new Error("PII_ENCRYPTION_ACTIVE_KEY_ID must name a key present in PII_ENCRYPTION_KEYS");
    }
    this.index = decodeKey("PII_INDEX_KEY", env.PII_INDEX_KEY);
  }

  activeKeyId() {
    return this.active;
  }
  encryptionKey(keyId: string) {
    const key = this.keys.get(keyId);
    if (!key) throw new Error(`Unknown encryption key id "${keyId}" — was it rotated out too early?`);
    return key;
  }
  indexKey() {
    return this.index;
  }
}

let provider: KeyProvider | null = null;

/** Test and KMS hook. */
export function setKeyProvider(next: KeyProvider) {
  provider = next;
}

function keys(): KeyProvider {
  // Lazy so importing this module during `next build` needs no secrets.
  return (provider ??= new EnvKeyProvider());
}

/** Column identities used as AAD. Add one per encrypted column; never reuse. */
export const CTX = {
  donorName: "donations.donor_name",
  donorEmail: "donations.donor_email",
  donorMessage: "donations.message",
  contactName: "contacts.name",
  contactEmail: "contacts.email",
  contactPhone: "contacts.phone",
  inviteEmail: "participant_invites.email",
} as const;
export type EncryptionContext = (typeof CTX)[keyof typeof CTX];

export function encryptField(plaintext: string, context: EncryptionContext): string {
  const keyId = keys().activeKeyId();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, keys().encryptionKey(keyId), iv);
  cipher.setAAD(Buffer.from(context, "utf8"));
  const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final(), cipher.getAuthTag()]);
  return [VERSION, keyId, iv.toString("base64url"), body.toString("base64url")].join(".");
}

export function decryptField(envelope: string, context: EncryptionContext): string {
  const parts = envelope.split(".");
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error("Malformed ciphertext envelope");
  }
  const [, keyId, ivB64, bodyB64] = parts as [string, string, string, string];
  const body = Buffer.from(bodyB64, "base64url");
  if (body.length < TAG_BYTES) throw new Error("Malformed ciphertext envelope");

  const ciphertext = body.subarray(0, body.length - TAG_BYTES);
  const tag = body.subarray(body.length - TAG_BYTES);

  const decipher = createDecipheriv(ALGORITHM, keys().encryptionKey(keyId), Buffer.from(ivB64, "base64url"));
  decipher.setAAD(Buffer.from(context, "utf8"));
  decipher.setAuthTag(tag);
  // Throws on a wrong key, a wrong context, or any bit flip. That is the point.
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

export function encryptOptional(value: string | null | undefined, context: EncryptionContext): string | null {
  const trimmed = value?.trim();
  return trimmed ? encryptField(trimmed, context) : null;
}

export function decryptOptional(envelope: string | null | undefined, context: EncryptionContext): string | null {
  return envelope ? decryptField(envelope, context) : null;
}

// ---------------------------------------------------------------- normalization + blind index

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Digits with a leading +; bare 10-digit US numbers get +1. */
export function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return phone.trim().startsWith("+") ? `+${digits}` : digits;
}

export type IndexKind = "email" | "phone";

export function blindIndex(kind: IndexKind, value: string): string {
  const normalized = kind === "email" ? normalizeEmail(value) : normalizePhone(value);
  return createHmac("sha256", keys().indexKey()).update(`${kind}:${normalized}`).digest("hex");
}

/**
 * IP addresses are PII. This HMAC includes the calendar month, so the same
 * visitor is only linkable to themselves within a month and the salt rotates
 * with no scheduled job. Enough for abuse analysis; useless for tracking.
 */
export function hashIp(ip: string, now: Date = new Date()): string {
  const month = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  return createHmac("sha256", keys().indexKey()).update(`ip:${month}:${ip.trim()}`).digest("hex").slice(0, 32);
}

/** For scripts/keys.mts and tests. */
export function generateKeyMaterial() {
  return {
    encryptionKey: randomBytes(KEY_BYTES).toString("base64"),
    indexKey: randomBytes(KEY_BYTES).toString("base64"),
  };
}
