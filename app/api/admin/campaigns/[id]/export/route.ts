import { requireCampaignAdmin, authErrorResponse } from "@/lib/authz";
import { audit } from "@/lib/audit";
import { limiters, clientIp, tooMany } from "@/lib/ratelimit";
import { exportDonationsForAdmin } from "@/lib/queries/admin-donations";
import { toCsv } from "@/lib/csv-export";

/**
 * Every donor's name and email leaves the system here. So: campaign-admin only,
 * rate limited per user, audited with the row count, and never cacheable.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let ctx: Awaited<ReturnType<typeof requireCampaignAdmin>>;
  try {
    ctx = await requireCampaignAdmin(id);
  } catch (err) {
    return authErrorResponse(err);
  }

  const limit = await limiters.export.limit(ctx.user.id);
  if (!limit.success) return tooMany(limit);

  const rows = await exportDonationsForAdmin(ctx.campaign.id);

  await audit({
    action: "donation.export",
    targetType: "campaign",
    targetId: ctx.campaign.id,
    orgId: ctx.campaign.orgId,
    actorUserId: ctx.user.id,
    ip: clientIp(req),
    metadata: { row_count: rows.length, format: "csv" },
  });

  const csv = toCsv(
    ["Date (UTC)", "Status", "Donor name", "Donor email", "Anonymous", "Designated ($)", "Fee covered ($)", "Platform fee ($)", "Total charged ($)", "Refunded ($)", "Payment method", "Participant", "Attributed via", "Source", "Message", "Stripe payment intent", "Donation id"],
    rows.map((r) => [
      r.createdAt,
      r.status,
      r.donorName,
      r.donorEmail,
      r.isAnonymous,
      r.designatedCents / 100,
      r.feeCoveredCents / 100,
      r.platformFeeCents / 100,
      r.grossCents / 100,
      r.refundedCents / 100,
      r.paymentMethodType,
      r.participantName,
      r.medium,
      r.source,
      r.message,
      r.stripePaymentIntentId,
      r.id,
    ]),
  );

  const filename = `donations-${ctx.campaign.slug}-${new Date().toISOString().slice(0, 10)}.csv`;
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store, private",
    },
  });
}
