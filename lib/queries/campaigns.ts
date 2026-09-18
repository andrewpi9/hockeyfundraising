import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { campaigns, organizations, participants, donations, type Campaign } from "@/lib/db/schema";
import { slugify } from "@/lib/ids";

/** v1 is single-org. Returns null before the seed has run. */
export async function getOrg() {
  const [org] = await db.select().from(organizations).limit(1);
  return org ?? null;
}

/**
 * Correlated subqueries. The outer row is referenced as "campaigns"."id" in
 * raw form on purpose: interpolating `${campaigns.id}` inside a select-list
 * `sql` fragment renders the bare column name, which the inner alias then
 * shadows (d.campaign_id = d.id) and every total silently reads 0. The test
 * suite pins this.
 */
const OUTER_ID = sql.raw('"campaigns"."id"');

const raisedSubquery = sql<number>`(
  select coalesce(sum(d.designated_amount_cents), 0)
  from donations d
  where d.campaign_id = ${OUTER_ID} and d.status = 'succeeded'
)::int`;

const donorCountSubquery = sql<number>`(
  select count(*) from donations d
  where d.campaign_id = ${OUTER_ID} and d.status = 'succeeded'
)::int`;

const participantCountSubquery = sql<number>`(
  select count(*) from participants p
  where p.campaign_id = ${OUTER_ID} and p.status = 'active'
)::int`;

export type CampaignWithTotals = Campaign & {
  raisedCents: number;
  donorCount: number;
  participantCount: number;
};

const withTotals = {
  raisedCents: raisedSubquery,
  donorCount: donorCountSubquery,
  participantCount: participantCountSubquery,
};

export async function listCampaignsForOrg(orgId: string): Promise<CampaignWithTotals[]> {
  const rows = await db
    .select({ campaign: campaigns, ...withTotals })
    .from(campaigns)
    .where(eq(campaigns.orgId, orgId))
    .orderBy(desc(campaigns.createdAt));
  return rows.map((r) => ({ ...r.campaign, raisedCents: r.raisedCents, donorCount: r.donorCount, participantCount: r.participantCount }));
}

/** Public listing: drafts are invisible outside the admin area. */
export async function listPublicCampaigns(orgId: string): Promise<CampaignWithTotals[]> {
  const rows = await db
    .select({ campaign: campaigns, ...withTotals })
    .from(campaigns)
    .where(and(eq(campaigns.orgId, orgId), inArray(campaigns.status, ["active", "closed"])))
    // Enum order is declaration order (draft < active < closed), so sorting the
    // column directly would put closed campaigns first. Rank explicitly.
    .orderBy(asc(sql`case when ${campaigns.status} = 'active' then 0 else 1 end`), desc(campaigns.createdAt));
  return rows.map((r) => ({ ...r.campaign, raisedCents: r.raisedCents, donorCount: r.donorCount, participantCount: r.participantCount }));
}

export async function getCampaignWithTotals(id: string): Promise<CampaignWithTotals | null> {
  const [r] = await db
    .select({ campaign: campaigns, ...withTotals })
    .from(campaigns)
    .where(eq(campaigns.id, id))
    .limit(1);
  return r ? { ...r.campaign, raisedCents: r.raisedCents, donorCount: r.donorCount, participantCount: r.participantCount } : null;
}

/** Public lookup by slug. Drafts return null so the URL does not confirm they exist. */
export async function getPublicCampaignBySlug(orgId: string, slug: string): Promise<CampaignWithTotals | null> {
  const [r] = await db
    .select({ campaign: campaigns, ...withTotals })
    .from(campaigns)
    .where(and(eq(campaigns.orgId, orgId), eq(campaigns.slug, slug), inArray(campaigns.status, ["active", "closed"])))
    .limit(1);
  return r ? { ...r.campaign, raisedCents: r.raisedCents, donorCount: r.donorCount, participantCount: r.participantCount } : null;
}

/** Slugs are unique per org; two "Spring Fund" campaigns get -2, -3, … */
export async function uniqueCampaignSlug(orgId: string, name: string): Promise<string> {
  const base = slugify(name) || "campaign";
  for (let i = 1; i < 100; i += 1) {
    const candidate = i === 1 ? base : `${base}-${i}`;
    const [clash] = await db
      .select({ id: campaigns.id })
      .from(campaigns)
      .where(and(eq(campaigns.orgId, orgId), eq(campaigns.slug, candidate)))
      .limit(1);
    if (!clash) return candidate;
  }
  throw new Error("Could not find a free slug");
}

export { participants, donations };
