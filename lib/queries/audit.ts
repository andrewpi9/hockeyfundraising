import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { auditLogs, users } from "@/lib/db/schema";

/** Newest first. Actor email is identity (plaintext on users), not donor PII. */
export async function listAuditLogs(orgId: string, limit = 200) {
  return db
    .select({
      id: auditLogs.id,
      createdAt: auditLogs.createdAt,
      action: auditLogs.action,
      targetType: auditLogs.targetType,
      targetId: auditLogs.targetId,
      metadata: auditLogs.metadata,
      actorIpHash: auditLogs.actorIpHash,
      actorEmail: users.email,
      actorName: users.name,
    })
    .from(auditLogs)
    .leftJoin(users, eq(auditLogs.actorUserId, users.id))
    .where(eq(auditLogs.orgId, orgId))
    .orderBy(desc(auditLogs.createdAt))
    .limit(limit);
}
