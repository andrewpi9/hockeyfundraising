"use client";

import { useCallback, useMemo, useState } from "react";
import { feeForAmount, formatMoney, formatMoneyShort, parseDollarsToCents, platformFeeFor, MIN_DONATION_CENTS } from "@/lib/money";
import { Button, Field, inputStyles, card } from "./ui";
import { Turnstile } from "./Turnstile";

const PRESETS = [2500, 5000, 10000, 25000, 50000];

export function DonateForm({
  campaignSlug,
  participantSlug,
  participantName,
  refCode,
  allowFeeCover,
  platformFeeBps,
  turnstileSiteKey,
  paymentsEnabled = true,
  testMode = false,
}: {
  campaignSlug: string;
  participantSlug?: string;
  participantName?: string;
  refCode?: string;
  allowFeeCover: boolean;
  platformFeeBps: number;
  turnstileSiteKey?: string;
  /** False until the organization's Stripe key is configured. */
  paymentsEnabled?: boolean;
  /** Stripe test mode on a live site: no real charges. */
  testMode?: boolean;
}) {
  const [selected, setSelected] = useState<number | "custom">(5000);
  const [custom, setCustom] = useState("");
  const [coverFee, setCoverFee] = useState(allowFeeCover);
  const [donorName, setDonorName] = useState("");
  const [donorEmail, setDonorEmail] = useState("");
  const [message, setMessage] = useState("");
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const amountCents = useMemo(() => (selected === "custom" ? (parseDollarsToCents(custom) ?? 0) : selected), [selected, custom]);
  const valid = amountCents >= MIN_DONATION_CENTS;
  // Preview only. The server recomputes every one of these from the same rules.
  const fee = valid && allowFeeCover ? feeForAmount(amountCents) : 0;
  const platformFee = valid ? platformFeeFor(amountCents, platformFeeBps) : 0;
  const total = amountCents + (coverFee ? fee : 0) + platformFee;

  const onToken = useCallback((t: string | null) => setTurnstileToken(t), []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!valid) return setError(`Minimum donation is ${formatMoney(MIN_DONATION_CENTS)}.`);
    if (turnstileSiteKey && !turnstileToken) return setError("Please complete the verification.");

    setPending(true);
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          campaignSlug,
          participantSlug,
          ref: refCode,
          amountCents,
          coverFee: coverFee && allowFeeCover,
          donorName: donorName.trim() || undefined,
          donorEmail: donorEmail.trim(),
          message: message.trim() || undefined,
          isAnonymous,
          turnstileToken: turnstileToken ?? undefined,
        }),
      });
      const data = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !data.url) {
        setError(data.error ?? "Something went wrong. Please try again.");
        setPending(false);
        return;
      }
      window.location.assign(data.url);
    } catch {
      setError("Network error. Please check your connection and try again.");
      setPending(false);
    }
  }

  if (!paymentsEnabled) {
    return (
      <div className={`${card} p-5 sm:p-6`}>
        <h2 className="text-lg font-bold">{participantName ? `Support ${participantName}` : "Make a donation"}</h2>
        <p className="mt-3 rounded-xl bg-carolina-50 px-4 py-3 text-sm leading-relaxed dark:bg-navy-800">
          <strong>Online donations open soon.</strong> The program is finishing its payment setup. Share this page now — the link stays the same — and check back to give.
        </p>
        <p className="mt-3 text-xs text-muted">When it opens: secure checkout by Stripe, no platform fee, funds go directly to the organization.</p>
      </div>
    );
  }

  const pressed = (on: boolean) =>
    `rounded-xl border px-2 py-3 text-base font-bold tabular-nums transition ${on ? "border-carolina-400 bg-carolina-400/15 text-carolina-700 dark:text-carolina-200" : "border-border hover:border-carolina-300"}`;

  return (
    <form onSubmit={handleSubmit} className={`${card} p-5 sm:p-6`}>
      <h2 className="text-lg font-bold">{participantName ? `Support ${participantName}` : "Make a donation"}</h2>
      <p className="mt-1 text-sm text-muted">
        {platformFeeBps === 0 ? "No platform fee. " : ""}Settles directly to the organization&rsquo;s account.
      </p>
      {testMode ? (
        <p role="status" className="mt-3 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
          Test mode — no real money moves. Use card 4242 4242 4242 4242 to try it.
        </p>
      ) : null}

      <fieldset className="mt-5">
        <legend className="mb-2 text-sm font-medium">Choose an amount</legend>
        <div className="grid grid-cols-3 gap-2">
          {PRESETS.map((cents) => (
            <button key={cents} type="button" onClick={() => setSelected(cents)} aria-pressed={selected === cents} className={pressed(selected === cents)}>
              {formatMoneyShort(cents)}
            </button>
          ))}
          <button type="button" onClick={() => setSelected("custom")} aria-pressed={selected === "custom"} className={pressed(selected === "custom")}>
            Other
          </button>
        </div>
        {selected === "custom" ? (
          <div className="relative mt-2">
            <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted">$</span>
            <input type="text" inputMode="decimal" autoFocus value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="0.00" aria-label="Custom amount in dollars" className={`${inputStyles} pl-7`} />
          </div>
        ) : null}
      </fieldset>

      {allowFeeCover ? (
        <label className={`mt-4 flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition ${coverFee ? "border-carolina-300 bg-carolina-50 dark:bg-navy-800/60" : "border-border"}`}>
          <input type="checkbox" checked={coverFee} onChange={(e) => setCoverFee(e.target.checked)} className="mt-0.5 size-4 accent-carolina-500" />
          <span className="text-sm">
            <span className="font-semibold">Add {formatMoney(fee)} to cover card processing</span>
            <span className="block text-muted">The program keeps the full {formatMoneyShort(amountCents || 0)} instead of paying Stripe out of your gift. Optional.</span>
          </span>
        </label>
      ) : null}

      <div className="mt-4 space-y-3">
        <Field label="Your name" hint="Shown on the donor wall unless you choose otherwise.">
          <input type="text" value={donorName} onChange={(e) => setDonorName(e.target.value)} autoComplete="name" placeholder="Jordan Smith" maxLength={120} className={inputStyles} />
        </Field>
        <Field label="Email" hint="For your tax receipt. Encrypted at rest, never shared or sold.">
          <input type="email" required value={donorEmail} onChange={(e) => setDonorEmail(e.target.value)} autoComplete="email" placeholder="you@example.com" className={inputStyles} />
        </Field>
        <Field label="Leave a note (optional)">
          <textarea value={message} onChange={(e) => setMessage(e.target.value.slice(0, 500))} rows={2} placeholder="Good luck this season!" className={`${inputStyles} resize-y`} />
        </Field>
        <label className="flex cursor-pointer items-center gap-2.5 text-sm">
          <input type="checkbox" checked={isAnonymous} onChange={(e) => setIsAnonymous(e.target.checked)} className="size-4 accent-carolina-500" />
          Make my donation anonymous
        </label>
      </div>

      {turnstileSiteKey ? <div className="mt-4"><Turnstile siteKey={turnstileSiteKey} onToken={onToken} /></div> : null}

      {error ? <p role="alert" className="mt-4 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/50 dark:text-red-300">{error}</p> : null}

      <Button type="submit" disabled={pending || !valid} className="mt-5 w-full text-base">
        {pending ? "Opening secure checkout…" : `Donate ${formatMoney(total)}`}
      </Button>
      <p className="mt-3 text-center text-xs text-muted">Secure checkout by Stripe. Card details never touch this site.</p>
    </form>
  );
}
