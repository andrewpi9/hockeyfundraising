import { Resend } from "resend";
import { formatMoney } from "./money";
import { escapeHtml as esc } from "./html";
import { isProductionDeploy } from "./site";
import { maskEmail } from "./mask";

const from = process.env.EMAIL_FROM ?? "fundraising@example.org";

/**
 * .env.example ships "re_..." as a placeholder, and a placeholder is truthy.
 * Requiring the shape of a real key means an unconfigured install falls back
 * to console logging instead of dying on a 401.
 */
function usableKey(): string | null {
  const key = process.env.RESEND_API_KEY;
  return key && /^re_[A-Za-z0-9]{8,}$/.test(key) ? key : null;
}

let client: Resend | null | undefined;
export function getResend(): Resend | null {
  if (client !== undefined) return client;
  const key = usableKey();
  client = key ? new Resend(key) : null;
  return client;
}

type SendArgs = { to: string; subject: string; html: string; text: string; headers?: Record<string, string> };

/** Returns the provider message id, or a synthetic one in unconfigured local dev. */
async function send({ to, subject, html, text, headers }: SendArgs): Promise<string> {
  const resend = getResend();
  if (!resend) {
    if (isProductionDeploy()) {
      // Misconfigured production must not write recipients and bodies to the log stream.
      console.error(`[email] RESEND_API_KEY not configured; dropped "${subject}" to ${maskEmail(to)}`);
      throw new Error("Email is not configured.");
    }
    if (!process.env.EMAIL_SILENT) {
      console.log(`\n--- EMAIL (RESEND_API_KEY not configured) ---\nTo: ${to}\nSubject: ${subject}\n\n${text}\n---\n`);
    }
    return `dev-${Date.now().toString(36)}`;
  }
  const { data, error } = await resend.emails.send({ from, to, subject, html, text, headers });
  if (error) throw new Error(`Resend failed: ${error.message}`);
  return data?.id ?? "unknown";
}

const shell = (body: string, footer = "") => `<!doctype html><html><body style="margin:0;padding:24px;background:#f5f5f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1c1917">
<div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;padding:32px;border:1px solid #e7e5e4">${body}</div>
${footer ? `<div style="max-width:560px;margin:16px auto 0;font-size:12px;line-height:1.6;color:#78716c;text-align:center">${footer}</div>` : ""}
</body></html>`;

const button = (href: string, label: string) =>
  `<a href="${esc(href)}" style="display:inline-block;background:#4B9CD3;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600">${esc(label)}</a>`;

// ---------------------------------------------------------------- participant invite (admin → athlete)

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
    text: `${who} invited you to join ${args.campaignName} for ${args.orgName}.\n\nAccept your invitation: ${args.url}\n\nYou'll get a personal page and share link. The link is for you only and expires in 14 days.`,
    html: shell(
      `<h1 style="margin:0 0 16px;font-size:20px">You're invited</h1>
       <p style="margin:0 0 24px;line-height:1.6">${esc(who)} invited you to join <strong>${esc(args.campaignName)}</strong> for ${esc(args.orgName)}. You'll get a personal fundraising page and a share link.</p>
       ${button(args.url, "Accept invitation")}
       <p style="margin:24px 0 0;font-size:13px;color:#78716c">This link is for you only and expires in 14 days. If you weren't expecting it, you can ignore this email.</p>`,
    ),
  });
}

// ---------------------------------------------------------------- outreach (athlete → their contact)

/**
 * The one email the platform sends on a participant's behalf. Everything CAN-SPAM
 * asks for is here: an accurate From, the org's physical address, a working
 * unsubscribe, and an RFC 8058 one-click header so mail clients can honour it
 * without loading a page.
 */
export async function sendOutreachInvite(args: {
  to: string;
  participantName: string;
  campaignName: string;
  orgName: string;
  orgAddress: string;
  note: string | null;
  url: string;
  unsubscribeUrl: string;
  oneClickUrl: string;
}): Promise<string> {
  const first = args.participantName.split(" ")[0] ?? args.participantName;
  const note = args.note?.trim() || null;

  const text = `Hi,

${first} is raising money for ${args.campaignName} with ${args.orgName} and added you to their list.
${note ? `\n"${note}"\n` : ""}
If you're able to chip in, anything helps — 100% goes to the program, there's no platform fee, and it's tax-deductible to the extent the law allows:
${args.url}

Thank you,
${args.participantName}

—
${args.orgName} · ${args.orgAddress}
You're receiving this because ${first} added you to their contacts. Unsubscribe: ${args.unsubscribeUrl}`;

  return send({
    to: args.to,
    subject: `${first} is fundraising for ${args.campaignName}`,
    text,
    headers: {
      "List-Unsubscribe": `<${args.oneClickUrl}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
    html: shell(
      `<p style="margin:0 0 16px;line-height:1.6"><strong>${esc(first)}</strong> is raising money for <strong>${esc(args.campaignName)}</strong> with ${esc(args.orgName)} and added you to their list.</p>
       ${note ? `<blockquote style="margin:0 0 20px;padding:12px 16px;border-left:3px solid #4B9CD3;background:#f0f8fd;border-radius:8px;line-height:1.6">${esc(note)}</blockquote>` : ""}
       <p style="margin:0 0 24px;line-height:1.6">If you're able to chip in, anything helps — 100% goes to the program, there's no platform fee, and it's tax-deductible to the extent the law allows.</p>
       ${button(args.url, `Support ${first}`)}
       <p style="margin:24px 0 0;line-height:1.6">Thank you,<br>${esc(args.participantName)}</p>`,
      `${esc(args.orgName)} · ${esc(args.orgAddress)}<br>You're receiving this because ${esc(first)} added you to their contacts. <a href="${esc(args.unsubscribeUrl)}" style="color:#78716c">Unsubscribe</a>`,
    ),
  });
}

// ---------------------------------------------------------------- donation receipt

export async function sendDonationReceipt(args: {
  to: string;
  donorName: string | null;
  amountCents: number;
  feeCoveredCents: number;
  campaignName: string;
  participantName: string | null;
  donationId: string;
  org: { legalName: string | null; ein: string | null; address: string | null };
}) {
  const orgName = args.org.legalName ?? "the organization";
  const total = args.amountCents + args.feeCoveredCents;
  const credited = args.participantName ? `Your gift was credited to ${args.participantName}.` : `Your gift supports the whole program.`;
  const greeting = args.donorName ?? "friend";

  // IRS Pub. 1771: a written acknowledgment must state the amount of cash
  // received and whether any goods or services were given in return.
  const text = `Thank you, ${greeting}.

Contribution: ${formatMoney(args.amountCents)}
${args.feeCoveredCents > 0 ? `Processing covered: ${formatMoney(args.feeCoveredCents)}\n` : ""}Total charged: ${formatMoney(total)}

${credited}

${orgName}${args.org.ein ? ` (EIN ${args.org.ein})` : ""}
${args.org.address ?? ""}
No goods or services were provided in exchange for this contribution.
Receipt ID: ${args.donationId}`;

  await send({
    to: args.to,
    subject: `Your ${formatMoney(total)} gift to ${args.campaignName}`,
    text,
    html: shell(
      `<h1 style="margin:0 0 16px;font-size:20px">Thank you, ${esc(greeting)}.</h1>
       <p style="margin:0 0 24px;line-height:1.6">${esc(credited)}</p>
       <table style="width:100%;border-collapse:collapse;font-size:15px">
         <tr><td style="padding:8px 0;color:#57534e">Contribution</td><td align="right" style="padding:8px 0;font-weight:600">${formatMoney(args.amountCents)}</td></tr>
         ${args.feeCoveredCents > 0 ? `<tr><td style="padding:8px 0;color:#57534e">Processing covered</td><td align="right" style="padding:8px 0">${formatMoney(args.feeCoveredCents)}</td></tr>` : ""}
         <tr><td style="padding:12px 0 0;border-top:1px solid #e7e5e4;font-weight:600">Total charged</td><td align="right" style="padding:12px 0 0;border-top:1px solid #e7e5e4;font-weight:600">${formatMoney(total)}</td></tr>
       </table>
       <div style="margin:24px 0 0;padding-top:16px;border-top:1px solid #e7e5e4;font-size:13px;color:#78716c;line-height:1.6">
         <strong>${esc(orgName)}</strong>${args.org.ein ? ` &middot; EIN ${esc(args.org.ein)}` : ""}<br>${esc(args.org.address ?? "")}<br>
         No goods or services were provided in exchange for this contribution.<br>
         Receipt ID: ${esc(args.donationId)}
       </div>`,
    ),
  });
}

// ---------------------------------------------------------------- participant nudge (admin → athlete)

/** Sent to a participant's OWN account address, never to donors or contacts. */
export async function sendParticipantNudge(args: { to: string; firstName: string; campaignName: string; coachName: string | null; consoleUrl: string }) {
  const from = args.coachName ? `${args.coachName}` : "your coach";
  await send({
    to: args.to,
    subject: `${args.campaignName}: your page is ready — share it`,
    text: `Hi ${args.firstName},

You're on the roster for ${args.campaignName} but haven't shared your page yet. Players who send 20+ messages raise about three times as much as those who send five.

Your page and share tools: ${args.consoleUrl}

Text five people today. That's it.

— ${from}`,
    html: shell(
      `<h1 style="margin:0 0 16px;font-size:20px">Your page is ready, ${esc(args.firstName)}</h1>
       <p style="margin:0 0 16px;line-height:1.6">You're on the roster for <strong>${esc(args.campaignName)}</strong> but haven't shared your page yet. Players who send 20+ messages raise about three times as much as those who send five.</p>
       ${button(args.consoleUrl, "Open my page")}
       <p style="margin:24px 0 0;line-height:1.6">Text five people today. That's it.</p>
       <p style="margin:16px 0 0;color:#78716c">— ${esc(from)}</p>`,
    ),
  });
}

// ---------------------------------------------------------------- family share kit (athlete → parent)

/**
 * One email to a family member the player named. It carries everything they
 * need to spread the word from their OWN address book: the link, a note they
 * can forward as-is, and the QR. We send this once (and on request); they do
 * the rest, which is why it lands.
 */
export async function sendHelperKit(args: {
  to: string;
  helperFirstName: string;
  playerName: string;
  campaignName: string;
  orgName: string;
  orgAddress: string | null;
  pageUrl: string;
  qrUrl: string;
  unsubscribeUrl: string;
  oneClickUrl: string;
}): Promise<string> {
  const first = args.playerName.split(" ")[0] ?? args.playerName;
  const forwardText = `${first} is playing for ${args.orgName} this season and the team is raising money for ice time, travel and gear. If you're able to chip in, anything helps — every dollar goes to the program and it's tax-deductible to the extent the law allows. Here's ${first}'s page: ${args.pageUrl}`;

  const text = `Hi ${args.helperFirstName},

${first} added you as a helper for ${args.campaignName}. The single biggest thing you can do is send ${first}'s page to people who know your family — relatives, coworkers, neighbors, old teammates' parents.

${first}'s page: ${args.pageUrl}
Printable QR code: ${args.qrUrl}

Here's a note you can copy and send as-is:

${forwardText}

Thank you,
${args.orgName}

—
${args.orgName}${args.orgAddress ? ` · ${args.orgAddress}` : ""}
You're receiving this because ${first} added you as a helper. Unsubscribe: ${args.unsubscribeUrl}`;

  return send({
    to: args.to,
    subject: `${first}'s fundraising page — here's how to help`,
    text,
    headers: { "List-Unsubscribe": `<${args.oneClickUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
    html: shell(
      `<h1 style="margin:0 0 16px;font-size:20px">${esc(first)} added you as a helper</h1>
       <p style="margin:0 0 20px;line-height:1.6">The single biggest thing you can do for <strong>${esc(args.campaignName)}</strong> is send ${esc(first)}'s page to people who know your family — relatives, coworkers, neighbors, old teammates' parents.</p>
       ${button(args.pageUrl, `Open ${first}'s page`)}
       <p style="margin:24px 0 8px;font-weight:600">Copy and forward this note:</p>
       <blockquote style="margin:0 0 20px;padding:14px 16px;border-left:3px solid #4B9CD3;background:#f0f8fd;border-radius:8px;line-height:1.6;font-size:15px">${esc(forwardText)}</blockquote>
       <p style="margin:0 0 8px;font-weight:600">Or share the QR code:</p>
       <p style="margin:0 0 4px"><a href="${esc(args.qrUrl)}"><img src="${esc(args.qrUrl)}" alt="QR code for ${esc(first)}'s page" width="160" height="160" style="border:1px solid #e7e5e4;border-radius:8px;padding:6px;background:#fff"></a></p>
       <p style="margin:0 0 24px;font-size:13px;color:#78716c">Prints well on a flyer or a fridge.</p>
       <p style="margin:0;line-height:1.6">Thank you,<br>${esc(args.orgName)}</p>`,
      `${esc(args.orgName)}${args.orgAddress ? ` · ${esc(args.orgAddress)}` : ""}<br>You're receiving this because ${esc(first)} added you as a helper. <a href="${esc(args.unsubscribeUrl)}" style="color:#78716c">Unsubscribe</a>`,
    ),
  });
}
