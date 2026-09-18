import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { getActiveCampaign, getDonorExport } from "@/lib/queries";

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const str = String(value);
  // Leading =, +, - or @ makes a spreadsheet treat the cell as a formula.
  const safe = /^[=+\-@]/.test(str) ? `'${str}` : str;
  return `"${safe.replace(/"/g, '""')}"`;
}

export async function GET() {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const campaign = await getActiveCampaign();
  if (!campaign) {
    return NextResponse.json({ error: "No active campaign" }, { status: 404 });
  }

  const rows = await getDonorExport(campaign.id);
  const header = [
    "Date",
    "Donor name",
    "Email",
    "Amount",
    "Fee covered",
    "Total charged",
    "Anonymous",
    "Player",
    "Message",
    "Stripe payment",
  ];

  const body = rows.map((r) =>
    [
      r.createdAt.toISOString(),
      r.donorName,
      r.donorEmail,
      (r.amountCents / 100).toFixed(2),
      (r.feeCoveredCents / 100).toFixed(2),
      (r.totalChargedCents / 100).toFixed(2),
      r.isAnonymous ? "yes" : "no",
      r.participantName,
      r.message,
      r.stripePaymentIntentId,
    ]
      .map(csvCell)
      .join(","),
  );

  const csv = [header.map(csvCell).join(","), ...body].join("\n");
  const filename = `donors-${campaign.slug}-${new Date().toISOString().slice(0, 10)}.csv`;

  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      // Contains donor email addresses. Never let a proxy hold a copy.
      "cache-control": "no-store, private",
    },
  });
}
