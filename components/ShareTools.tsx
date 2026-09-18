"use client";

import { useState, useTransition } from "react";
import { recordOutreach, deleteContact } from "@/app/me/actions";
import { Button, buttonStyles, card } from "./ui";

export type ShareContact = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  code: string | null;
  lastContactedAt: Date | null;
};

function firstName(full: string) {
  return full.trim().split(/\s+/)[0] ?? full;
}

export function CopyLink({ url, label }: { url: string; label: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard is blocked in some in-app browsers; the input is selectable.
      setCopied(false);
    }
  }

  return (
    <div>
      <div className="mb-1.5 text-sm font-medium">{label}</div>
      <div className="flex gap-2">
        <input
          readOnly
          value={url}
          onFocus={(e) => e.currentTarget.select()}
          className="min-w-0 flex-1 rounded-xl border border-border bg-bg px-3 py-2 font-mono text-sm"
        />
        <Button type="button" variant="outline" onClick={copy} className="shrink-0">
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
    </div>
  );
}

export function ShareTools({
  contacts,
  playerName,
  campaignName,
  baseUrl,
}: {
  contacts: ShareContact[];
  playerName: string;
  campaignName: string;
  baseUrl: string;
}) {
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);

  function linkFor(contact: ShareContact) {
    return contact.code
      ? `${baseUrl}/r/${contact.code}`
      : `${baseUrl}/p/${encodeURIComponent(playerName)}`;
  }

  function smsBody(contact: ShareContact) {
    return `Hey ${firstName(contact.name)}! I'm raising money for ${campaignName} this season — it covers ice time, travel and gear. Anything helps, and it's tax-deductible. Here's my page: ${linkFor(contact)}`;
  }

  function emailBody(contact: ShareContact) {
    return `Hi ${firstName(contact.name)},

I'm playing hockey at UNC this year, and our team is raising money to cover ice time, travel and equipment for the season. We're running the fundraiser ourselves, so there's no platform taking a cut — every dollar goes straight to the team.

If you're able to chip in, anything helps, and your gift is tax-deductible:
${linkFor(contact)}

Thanks either way — it means a lot.

${playerName}`;
  }

  function open(contact: ShareContact, channel: "sms" | "email") {
    const url =
      channel === "sms"
        ? `sms:${contact.phone ?? ""}?&body=${encodeURIComponent(smsBody(contact))}`
        : `mailto:${contact.email ?? ""}?subject=${encodeURIComponent(
            `Helping fund ${campaignName}`,
          )}&body=${encodeURIComponent(emailBody(contact))}`;

    setBusyId(contact.id);
    // Hand off to the phone's own Messages or Mail app. The message goes out
    // from the player's real number, which is why these land instead of
    // getting filtered as bulk marketing.
    window.location.assign(url);

    startTransition(async () => {
      try {
        await recordOutreach(contact.id, channel);
      } finally {
        setBusyId(null);
      }
    });
  }

  if (contacts.length === 0) {
    return (
      <p className="text-sm text-muted">
        Add a few contacts above and share buttons will appear here.
      </p>
    );
  }

  return (
    <ul className="space-y-2">
      {contacts.map((contact) => (
        <li
          key={contact.id}
          className={`${card} flex flex-wrap items-center gap-3 p-3`}
        >
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate font-semibold">{contact.name}</span>
              {contact.lastContactedAt ? (
                <span className="shrink-0 rounded-full bg-carolina-100 px-2 py-0.5 text-[11px] font-medium text-carolina-700 dark:bg-navy-800 dark:text-carolina-200">
                  sent
                </span>
              ) : null}
            </div>
            <div className="truncate text-xs text-muted">
              {[contact.phone, contact.email].filter(Boolean).join(" · ")}
            </div>
          </div>

          <div className="flex shrink-0 gap-2">
            {contact.phone ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => open(contact, "sms")}
                disabled={pending && busyId === contact.id}
                className="px-3 py-1.5 text-sm"
              >
                Text
              </Button>
            ) : null}
            {contact.email ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => open(contact, "email")}
                disabled={pending && busyId === contact.id}
                className="px-3 py-1.5 text-sm"
              >
                Email
              </Button>
            ) : null}
            <form action={deleteContact}>
              <input type="hidden" name="contactId" value={contact.id} />
              <button
                type="submit"
                aria-label={`Remove ${contact.name}`}
                className={`${buttonStyles.ghost} text-muted hover:text-red-600`}
              >
                Remove
              </button>
            </form>
          </div>
        </li>
      ))}
    </ul>
  );
}
