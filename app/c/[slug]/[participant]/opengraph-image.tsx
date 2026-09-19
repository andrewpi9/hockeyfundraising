import { shareCard, OG_SIZE, OG_CONTENT_TYPE } from "@/lib/og";
import { brand, classYearLabel } from "@/lib/brand";
import { getOrg, getPublicCampaignBySlug } from "@/lib/queries/campaigns";
import { getParticipantPublic } from "@/lib/queries/participants";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const alt = `${brand.name} player fundraising page`;

export default async function Image({ params }: { params: Promise<{ slug: string; participant: string }> }) {
  const { slug, participant: pslug } = await params;
  const org = await getOrg();
  const campaign = org ? await getPublicCampaignBySlug(org.id, slug) : null;
  const row = campaign ? await getParticipantPublic(campaign.id, pslug) : null;
  if (!campaign || !row) {
    return shareCard({ eyebrow: brand.tagline, title: brand.name, raisedCents: 0, goalCents: 0, donorCount: 0 });
  }
  const p = row.participant;
  const subtitle = [p.rosterNumber ? `#${p.rosterNumber}` : null, p.teamRole, classYearLabel(p.classYear)].filter(Boolean).join(" · ");
  return shareCard({
    eyebrow: campaign.name,
    title: p.displayName,
    subtitle: subtitle || null,
    raisedCents: row.raisedCents,
    goalCents: p.goalCents,
    donorCount: row.donorCount,
    photoUrl: p.photoUrl,
    number: p.rosterNumber,
  });
}
