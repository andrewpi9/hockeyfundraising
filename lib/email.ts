import { Resend } from "resend";
import { formatMoney } from "./money";

const from = process.env.EMAIL_FROM ?? "fundraising@example.org";

/**
 * .env.example ships "re_..." as a placeholder, and a placeholder is truthy.
 * Requiring the shape of a real key means an unconfigured checkout falls back
 * to console logging instead of dying on a 401.
 */
function usableKey(): string | null {
  const key = process.env.RESEND_API_KEY;
  return key && /^re_[A-Za-z0-9]{8,}$/.test(key) ? key : null;
}

const apiKey = usableKey();
const resend = apiKey ? new Resend(apiKey) : null;

type SendArgs = { to: string; subject: string; html: string; text: string };

async function send({ to, subject, html, text }: SendArgs) {
  if (!resend) {
    // No usable key: log instead of throwing, so login and donation flows
    // stay testable end to end before email is configured.
    console.log(
      `\n--- EMAIL (RESEND_API_KEY not configured) ---\nTo: ${to}\nSubject: ${subject}\n\n${text}\n---\n`,
    );
    return;
  }
  const { error } = await resend.emails.send({ from, to, subject, html, text });
  if (error) throw new Error(`Resend failed: ${error.message}`);
}

const shell = (body: string) => `<!doctype html><html><body style="margin:0;padding:24px;background:#f5f5f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1c1917">
<div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;padding:32px;border:1px solid #e7e5e4">${body}</div>
</body></html>`;

export async function sendDonationReceipt(args: {
  to: string;
  donorName: string | null;
  amountCents: number;
  feeCoveredCents: number;
  campaignName: string;
  participantName: string | null;
  donationId: string;
}) {
  const orgName = process.env.NEXT_PUBLIC_ORG_LEGAL_NAME ?? "the team";
  const ein = process.env.NEXT_PUBLIC_ORG_EIN ?? "";
  const address = process.env.NEXT_PUBLIC_ORG_ADDRESS ?? "";
  const total = args.amountCents + args.feeCoveredCents;
  const credited = args.participantName
    ? `Your gift was credited to ${args.participantName}.`
    : `Your gift supports the whole team.`;

  // IRS Pub. 1771: a written acknowledgment must state the amount of cash
  // received and whether any goods or services were given in return.
  const text = `Thank you, ${args.donorName ?? "friend"}.

Contribution: ${formatMoney(args.amountCents)}
${args.feeCoveredCents > 0 ? `Processing covered: ${formatMoney(args.feeCoveredCents)}\n` : ""}Total charged: ${formatMoney(total)}

${credited}

${orgName}${ein ? ` (EIN ${ein})` : ""}
${address}
No goods or services were provided in exchange for this contribution.
Receipt ID: ${args.donationId}`;

  await send({
    to: args.to,
    subject: `Your ${formatMoney(total)} gift to ${args.campaignName}`,
    text,
    html: shell(
      `<h1 style="margin:0 0 16px;font-size:20px">Thank you, ${args.donorName ?? "friend"}.</h1>
       <p style="margin:0 0 24px;line-height:1.6">${credited}</p>
       <table style="width:100%;border-collapse:collapse;font-size:15px">
         <tr><td style="padding:8px 0;color:#57534e">Contribution</td><td align="right" style="padding:8px 0;font-weight:600">${formatMoney(args.amountCents)}</td></tr>
         ${args.feeCoveredCents > 0 ? `<tr><td style="padding:8px 0;color:#57534e">Processing covered</td><td align="right" style="padding:8px 0">${formatMoney(args.feeCoveredCents)}</td></tr>` : ""}
         <tr><td style="padding:12px 0 0;border-top:1px solid #e7e5e4;font-weight:600">Total charged</td><td align="right" style="padding:12px 0 0;border-top:1px solid #e7e5e4;font-weight:600">${formatMoney(total)}</td></tr>
       </table>
       <div style="margin:24px 0 0;padding-top:16px;border-top:1px solid #e7e5e4;font-size:13px;color:#78716c;line-height:1.6">
         <strong>${orgName}</strong>${ein ? ` &middot; EIN ${ein}` : ""}<br>${address}<br>
         No goods or services were provided in exchange for this contribution.<br>
         Receipt ID: ${args.donationId}
       </div>`,
    ),
  });
}

export async function sendParticipantInvite(args: {
  to: string;
  campaignName: string;
  orgName: string;
  inviterName: string | null;
  url: string;
}) {
  const who = args.inviterName ? `${args.inviterName} has` : "Your coach has";
  await send({
    to: args.to,
    subject: `You're invited to fundraise for ${args.campaignName}`,
    text: `${who} invited you to join ${args.campaignName} for ${args.orgName}.

Accept your invitation: ${args.url}

You'll get a personal page and share link. The link is for you only and expires in 14 days.`,
    html: shell(
      `<h1 style="margin:0 0 16px;font-size:20px">You're invited</h1>
       <p style="margin:0 0 24px;line-height:1.6">${who} invited you to join <strong>${args.campaignName}</strong> for ${args.orgName}. You'll get a personal fundraising page and a share link.</p>
       <a href="${args.url}" style="display:inline-block;background:#4B9CD3;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600">Accept invitation</a>
       <p style="margin:24px 0 0;font-size:13px;color:#78716c">This link is for you only and expires in 14 days. If you weren't expecting it, you can ignore this email.</p>`,
    ),
  });
}
