import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { participants, campaigns } from "@/lib/db/schema";
import { getParticipantStats } from "@/lib/queries/donations";
import { limiters, clientIp, tooMany } from "@/lib/ratelimit";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const limit = await limiters.stats.limit(clientIp(req));
  if (!limit.success) return tooMany(limit);

  const { id } = await params;
  if (!UUID.test(id)) return Response.json({ error: "Not found" }, { status: 404 });

  const [row] = await db
    .select({ goalCents: participants.goalCents })
    .from(participants)
    .innerJoin(campaigns, eq(participants.campaignId, campaigns.id))
    .where(and(eq(participants.id, id), eq(participants.status, "active"), inArray(campaigns.status, ["active", "closed"])))
    .limit(1);
  if (!row) return Response.json({ error: "Not found" }, { status: 404 });

  const stats = await getParticipantStats(id);
  return Response.json(
    { raisedCents: stats.raisedCents, donorCount: stats.donorCount, goalCents: row.goalCents, at: new Date().toISOString() },
    { headers: { "cache-control": "public, s-maxage=5, stale-while-revalidate=15" } },
  );
}
