import { shareCard, OG_SIZE, OG_CONTENT_TYPE } from "@/lib/og";
import { brand } from "@/lib/brand";
import { getOrg, getPublicCampaignBySlug } from "@/lib/queries/campaigns";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const alt = `${brand.name} fundraiser`;

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const org = await getOrg();
  const campaign = org ? await getPublicCampaignBySlug(org.id, slug) : null;
  if (!campaign) {
    return shareCard({ eyebrow: brand.tagline, title: brand.name, raisedCents: 0, goalCents: 0, donorCount: 0 });
  }
  return shareCard({
    eyebrow: brand.tagline,
    title: campaign.name,
    subtitle: `${campaign.participantCount} players · every dollar to the program`,
    raisedCents: campaign.raisedCents,
    goalCents: campaign.goalCents,
    donorCount: campaign.donorCount,
  });
}
