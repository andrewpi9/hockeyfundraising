import { loadContactRows } from "@/lib/queries/contacts";
import { CONTACT_CAP } from "@/lib/outreach";
import { emailConfigured } from "@/lib/email";
import { card } from "@/components/ui";
import { ContactsList, ImportForm, PasteForm, AddContactForm } from "./ContactsControls";

/**
 * Server component. Renders the participant's OWN contacts — their data, entered
 * by them. The page guard already proved ownership before this runs.
 */
export async function Contacts({ participantId, campaignActive }: { participantId: string; campaignActive: boolean }) {
  const contacts = await loadContactRows(participantId);
  const reached = contacts.filter((c) => c.inviteCount > 0 || c.smsTaps > 0).length;
  const pct = contacts.length ? Math.round((reached / contacts.length) * 100) : 0;

  return (
    <section className={`${card} p-5`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-2xl font-bold uppercase">Your contacts</h2>
        <span className="text-sm tabular-nums text-muted">
          {contacts.length} / {CONTACT_CAP}
        </span>
      </div>
      <p className="mt-1 text-sm text-muted">
        This is where the money comes from. Add the people who know you, then text them from your own phone or send the templated email — each with a link tracked back to you.
        Nobody is contacted automatically.
      </p>

      {contacts.length > 0 ? (
        <div className="mt-4">
          <div className="flex items-baseline justify-between text-sm">
            <span>
              Reached <strong className="font-display text-lg">{reached}</strong> of {contacts.length}
            </span>
            <span className="font-display text-lg text-carolina-600 dark:text-carolina-300">{pct}%</span>
          </div>
          <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-carolina-100 dark:bg-navy-800">
            <div className="animate-fill h-full rounded-full bg-gradient-to-r from-carolina-600 to-carolina-300" style={{ width: `${Math.max(pct, reached > 0 ? 2 : 0)}%` }} />
          </div>
        </div>
      ) : null}

      <div className="mt-6 space-y-5">
        {contacts.length < CONTACT_CAP ? <PasteForm participantId={participantId} /> : <p className="text-sm text-muted">Your list is full. Remove someone to add another.</p>}
        <div className="flex flex-wrap gap-4 text-sm">
          <details className="rounded-xl border border-border p-3">
            <summary className="cursor-pointer font-medium">Upload a CSV instead</summary>
            <div className="mt-3 w-80 max-w-full"><ImportForm participantId={participantId} /></div>
          </details>
          <details className="rounded-xl border border-border p-3">
            <summary className="cursor-pointer font-medium">Add one person</summary>
            <div className="mt-3 w-96 max-w-full"><AddContactForm participantId={participantId} /></div>
          </details>
        </div>
        <div className="border-t border-border pt-5">
          <ContactsList participantId={participantId} contacts={contacts} campaignActive={campaignActive} emailEnabled={emailConfigured()} />
        </div>
      </div>
    </section>
  );
}
