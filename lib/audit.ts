import { db } from "./db";
import { auditLogs } from "./db/schema";
import { hashIp } from "./crypto";

export type AuditAction =
  | "auth.bootstrap_admin"
  | "org.update"
  | "membership.grant"
  | "membership.revoke"
  | "campaign.create"
  | "campaign.update"
  | "campaign.status_change"
  | "participant.invite"
  | "participant.claim"
  | "roster.import"
  | "participant.invite_revoke"
  | "participant.remove"
  | "participant.update_by_admin"
  | "contacts.import"
  | "donation.export"
  | "donation.view_pii"
  | "suppression.add";

export type AuditMetadata = Record<string, string | number | boolean | null>;

/**
 * Keys that look like they carry a value rather than an identifier. Rejected
 * at runtime so "never log PII" is enforced by the audit writer itself, not by
 * every caller remembering.
 */
const PII_LIKE_KEY = /(email|name|phone|address|donor|message|note|bio|ciphertext|token|secret|password|key)/i;

export async function audit(entry: {
  action: AuditAction;
  targetType: string;
  targetId?: string | null;
  orgId?: string | null;
  actorUserId?: string | null;
  ip?: string | null;
  metadata?: AuditMetadata;
}): Promise<void> {
  const metadata = entry.metadata ?? {};
  for (const key of Object.keys(metadata)) {
    if (PII_LIKE_KEY.test(key)) {
      throw new Error(
        `audit(): metadata key "${key}" looks like it carries PII. Log an id or a count, not a value.`,
      );
    }
    const value = metadata[key];
    if (typeof value === "string" && value.length > 200) {
      throw new Error(`audit(): metadata "${key}" is too long to be an identifier.`);
    }
  }

  await db.insert(auditLogs).values({
    action: entry.action,
    targetType: entry.targetType,
    targetId: entry.targetId ?? null,
    orgId: entry.orgId ?? null,
    actorUserId: entry.actorUserId ?? null,
    actorIpHash: entry.ip ? hashIp(entry.ip) : null,
    metadata,
  });
}
