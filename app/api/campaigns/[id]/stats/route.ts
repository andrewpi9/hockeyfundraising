import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { campaigns } from "@/lib/db/schema";
import { getCampaignStats } from "@/lib/queries/donations";
import { limiters, clientIp, tooMany } from "@/lib/ratelimit";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * The live-thermometer feed. Three numbers and a timestamp, no PII, so it is
 * safe to cache at the edge and to poll. Drafts 404 so the URL confirms nothing.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const limit = await limiters.stats.limit(clientIp(req));
  if (!limit.success) return tooMany(limit);

  const { id } = await params;
  if (!UUID.test(id)) return Response.json({ error: "Not found" }, { status: 404 });

  const [campaign] = await db
    .select({ goalCents: campaigns.goalCents })
    .from(campaigns)
    .where(and(eq(campaigns.id, id), inArray(campaigns.status, ["active", "closed"])))
    .limit(1);
  if (!campaign) return Response.json({ error: "Not found" }, { status: 404 });

  const stats = await getCampaignStats(id);
  return Response.json(
    { raisedCents: stats.raisedCents, donorCount: stats.donorCount, goalCents: campaign.goalCents, at: new Date().toISOString() },
    { headers: { "cache-control": "public, s-maxage=5, stale-while-revalidate=15" } },
  );
}
