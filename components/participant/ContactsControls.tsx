"use client";

import { useActionState, useMemo, useState, useTransition } from "react";
import { importContacts, addContact, deleteContact, sendInvites, prepareSms } from "@/app/dashboard/actions";
import { Button, Field, inputStyles } from "@/components/ui";
import { Notice } from "@/components/admin/CampaignForm";

import type { ContactRow } from "@/lib/queries/contacts";

export function ImportForm({ participantId }: { participantId: string }) {
  const [state, action, pending] = useActionState(importContacts, null);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="participantId" value={participantId} />
      <Field label="Import a CSV" hint="Export from your phone's contacts or a spreadsheet. Columns for name, email and phone in any order; up to 1 MB.">
        <input name="file" type="file" accept=".csv,text/csv" required className={`${inputStyles} file:mr-3 file:rounded-lg file:border-0 file:bg-carolina-100 file:px-3 file:py-1.5 file:text-sm file:font-medium dark:file:bg-navy-800`} />
      </Field>
      <label className="flex cursor-pointer items-start gap-3 text-sm">
        <input type="checkbox" name="attest" required className="mt-0.5 size-4 accent-carolina-500" />
        <span>These are people who know me personally — family, friends, teachers, coaches. I&rsquo;m not uploading a purchased or scraped list.</span>
      </label>
      <Notice state={state} />
      <Button type="submit" variant="outline" disabled={pending}>{pending ? "Importing…" : "Import contacts"}</Button>
    </form>
  );
}

export function AddContactForm({ participantId }: { participantId: string }) {
  const [state, action, pending] = useActionState(addContact, null);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="participantId" value={participantId} />
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Name"><input name="name" required maxLength={120} placeholder="Aunt Sarah" className={inputStyles} /></Field>
        <Field label="Email"><input name="email" type="email" placeholder="sarah@example.com" className={inputStyles} /></Field>
        <Field label="Phone"><input name="phone" type="tel" placeholder="(919) 555-0199" className={inputStyles} /></Field>
      </div>
      <Notice state={state} />
      <Button type="submit" variant="outline" disabled={pending}>{pending ? "Adding…" : "Add"}</Button>
    </form>
  );
}

function statusLabel(c: ContactRow): { text: string; tone: "muted" | "good" | "bad" } | null {
  if (c.unsubscribed) return { text: "unsubscribed", tone: "bad" };
  if (c.lastInviteStatus === "bounced") return { text: "bounced", tone: "bad" };
  if (c.lastInviteStatus === "complained") return { text: "marked as spam", tone: "bad" };
  if (c.daysSinceInvite !== null) {
    return { text: c.daysSinceInvite === 0 ? "emailed today" : `emailed ${c.daysSinceInvite}d ago`, tone: "good" };
  }
  if (c.smsTaps > 0) return { text: "texted", tone: "good" };
  return null;
}

export function ContactsList({ participantId, contacts, campaignActive }: { participantId: string; contacts: ContactRow[]; campaignActive: boolean }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sendState, sendAction, sending] = useActionState(sendInvites, null);
  const [pendingSms, startSms] = useTransition();
  const [smsError, setSmsError] = useState<string | null>(null);

  const eligible = useMemo(() => contacts.filter((c) => c.eligibleForEmail), [contacts]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < 25) next.add(id);
      return next;
    });
  }
  function selectAllEligible() {
    setSelected(new Set(eligible.slice(0, 25).map((c) => c.id)));
  }

  function text(contact: ContactRow) {
    setSmsError(null);
    const fd = new FormData();
    fd.set("participantId", participantId);
    fd.set("contactId", contact.id);
    startSms(async () => {
      const res = await prepareSms(fd);
      if (res.ok) window.location.assign(res.href);
      else setSmsError(res.message);
    });
  }

  if (contacts.length === 0) return <p className="text-sm text-muted">No contacts yet. Import a CSV or add someone above.</p>;

  return (
    <div>
      <form action={sendAction} className="mb-4 rounded-xl border border-border p-4">
        <input type="hidden" name="participantId" value={participantId} />
        {[...selected].map((id) => <input key={id} type="hidden" name="contactIds" value={id} />)}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm">
            <strong>{selected.size}</strong> selected for email
            {eligible.length > 0 ? (
              <button type="button" onClick={selectAllEligible} className="ml-3 text-carolina-600 hover:underline dark:text-carolina-300">
                select all eligible ({Math.min(eligible.length, 25)})
              </button>
            ) : null}
          </div>
          <Button type="submit" disabled={sending || selected.size === 0 || !campaignActive} className="px-4 py-2 text-sm">
            {sending ? "Sending…" : `Send ${selected.size || ""} invite${selected.size === 1 ? "" : "s"}`}
          </Button>
        </div>
        <textarea
          name="note"
          rows={2}
          maxLength={300}
          placeholder="Optional personal note, in your own words (300 characters)."
          className={`${inputStyles} mt-3 resize-y text-sm`}
        />
        {!campaignActive ? <p className="mt-2 text-xs text-muted">Email invites open when the campaign launches. Texting works now.</p> : null}
        <Notice state={sendState} />
      </form>

      {smsError ? <p role="alert" className="mb-3 text-sm text-red-600">{smsError}</p> : null}

      <ul className="divide-y divide-border">
        {contacts.map((c) => {
          const status = statusLabel(c);
          const canEmail = c.eligibleForEmail;
          return (
            <li key={c.id} className="flex flex-wrap items-center gap-3 py-3">
              <input
                type="checkbox"
                aria-label={`Select ${c.name} for email`}
                checked={selected.has(c.id)}
                disabled={!canEmail}
                onChange={() => toggle(c.id)}
                className="size-4 accent-carolina-500 disabled:opacity-30"
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate font-medium">{c.name}</span>
                  {status ? (
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${status.tone === "bad" ? "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300" : status.tone === "good" ? "bg-carolina-100 text-carolina-800 dark:bg-navy-800 dark:text-carolina-200" : "bg-stone-100 text-stone-600"}`}>
                      {status.text}
                    </span>
                  ) : null}
                  {c.clickCount > 0 ? <span className="text-[11px] text-muted">{c.clickCount} click{c.clickCount === 1 ? "" : "s"}</span> : null}
                </div>
                <div className="truncate text-xs text-muted">{[c.phone, c.email].filter(Boolean).join(" · ")}</div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {c.phone ? (
                  <Button type="button" variant="outline" disabled={pendingSms} onClick={() => text(c)} className="px-3 py-1.5 text-sm">Text</Button>
                ) : null}
                <form action={async (fd) => { await deleteContact(fd); }}>
                  <input type="hidden" name="participantId" value={participantId} />
                  <input type="hidden" name="contactId" value={c.id} />
                  <button type="submit" aria-label={`Remove ${c.name}`} className="px-2 py-1 text-xs text-muted hover:text-red-600">Remove</button>
                </form>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
