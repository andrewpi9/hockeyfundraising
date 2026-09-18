import { loadContactRows } from "@/lib/queries/contacts";
import { CONTACT_CAP } from "@/lib/outreach";
import { card } from "@/components/ui";
import { ContactsList, ImportForm, AddContactForm } from "./ContactsControls";

/**
 * Server component. Renders the participant's OWN contacts — their data, entered
 * by them. The page guard already proved ownership before this runs.
 */
export async function Contacts({ participantId, campaignActive }: { participantId: string; campaignActive: boolean }) {
  const contacts = await loadContactRows(participantId);

  return (
    <section className={`${card} p-5`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-bold">Your contacts</h2>
        <span className="text-sm tabular-nums text-muted">{contacts.length} / {CONTACT_CAP}</span>
      </div>
      <p className="mb-5 mt-1 text-sm text-muted">
        People who know you. Text them from your own phone with one tap, or send a templated email from the platform — each with a link tracked back to you.
        Nobody is contacted automatically.
      </p>

      <div className="space-y-6">
        <ImportForm participantId={participantId} />
        <details className="rounded-xl border border-border p-4">
          <summary className="cursor-pointer text-sm font-medium">Add one person</summary>
          <div className="mt-4"><AddContactForm participantId={participantId} /></div>
        </details>
        <div className="border-t border-border pt-5">
          <ContactsList participantId={participantId} contacts={contacts} campaignActive={campaignActive} />
        </div>
      </div>
    </section>
  );
}
