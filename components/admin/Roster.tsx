import Link from "next/link";
import { Avatar, card } from "@/components/ui";
import { formatMoneyShort } from "@/lib/money";
import { decryptField, CTX } from "@/lib/crypto";
import { maskEmail } from "@/lib/mask";
import { listRoster, listPendingInvites } from "@/lib/queries/participants";
import { InviteForm, RevokeInviteButton, RemoveParticipantButton, ClaimInviteForm } from "./RosterControls";

/** Server component: decrypts invite emails only to mask them. Never renders the full address. */
export async function Roster({ campaignId, campaignSlug }: { campaignId: string; campaignSlug: string }) {
  const [roster, invites] = await Promise.all([listRoster(campaignId), listPendingInvites(campaignId)]);

  return (
    <div className="space-y-6">
      <div className={`${card} p-5`}>
        <InviteForm campaignId={campaignId} />
        {invites.length > 0 ? (
          <ul className="mt-5 divide-y divide-border border-t border-border text-sm">
            {invites.map((inv) => (
              <li key={inv.id} className="flex items-center justify-between gap-3 py-2.5">
                <span className="font-mono">{maskEmail(decryptField(inv.emailCiphertext, CTX.inviteEmail))}</span>
                <span className="flex items-center gap-4 text-muted">
                  <span>expires {inv.expiresAt.toLocaleDateString()}</span>
                  <RevokeInviteButton inviteId={inv.id} />
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {roster.length === 0 ? (
        <p className="text-sm text-muted">Nobody has joined yet. Share the join code or send invites above.</p>
      ) : (
        <ul className="space-y-2">
          {roster.map(({ participant, unclaimed, raisedCents, donorCount, clickCount, contactCount, sendCount }) => (
            <li key={participant.id} className={`${card} flex flex-wrap items-center gap-3 p-3`}>
              <Avatar src={participant.photoUrl} name={participant.displayName} size={40} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <Link href={`/c/${campaignSlug}/${participant.slug}`} className="font-semibold hover:underline">
                    {participant.displayName}
                  </Link>
                  {participant.rosterNumber ? <span className="font-display text-sm font-semibold text-carolina-600 dark:text-carolina-300">#{participant.rosterNumber}</span> : null}
                  {unclaimed ? (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-950/40 dark:text-amber-200" title="Imported. No account yet — send a claim invite so they can sign in to this page.">
                      unclaimed
                    </span>
                  ) : null}
                </div>
                <div className="text-xs text-muted">
                  {formatMoneyShort(raisedCents)} · {donorCount} {donorCount === 1 ? "donor" : "donors"} · {contactCount} contacts · {sendCount} sent · {clickCount} clicks
                </div>
              </div>
              {unclaimed ? <ClaimInviteForm campaignId={campaignId} participantId={participant.id} /> : null}
              <RemoveParticipantButton participantId={participant.id} name={participant.displayName} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
