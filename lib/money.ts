/**
 * Stripe's cut. Configured, not hard-coded, because the org's actual rate
 * changes: 2.9% + 30¢ standard, 2.2% + 30¢ once Stripe approves the nonprofit
 * rate. The default is the STANDARD rate on purpose — under-collecting the
 * "cover the fee" add-on quietly costs the org money; over-collecting by 0.7%
 * for a few weeks does not.
 *
 * NEXT_PUBLIC_ so the client can preview the same number the server charges.
 * The server never trusts the client's arithmetic; it recomputes.
 */
function percent(): number {
  // Parsed to integer basis points first: 2.9 / 100 is 0.028999999999999998 in
  // IEEE 754, while 290 / 10_000 is exactly the double 0.029. Predictable math.
  const v = Number(process.env.NEXT_PUBLIC_STRIPE_FEE_PERCENT ?? "2.9");
  const bps = Number.isFinite(v) && v >= 0 && v < 10 ? Math.round(v * 100) : 290;
  return bps / 10_000;
}
function fixedCents(): number {
  const v = Number(process.env.NEXT_PUBLIC_STRIPE_FEE_FIXED_CENTS ?? "30");
  return Number.isFinite(v) && v >= 0 && v < 500 ? Math.round(v) : 30;
}

export function stripeFeeRate() {
  return { percent: percent(), fixedCents: fixedCents() };
}

/** What to charge so the org nets exactly `netCents` after Stripe. */
export function grossUpForFees(netCents: number): number {
  const { percent: p, fixedCents: f } = stripeFeeRate();
  return Math.round((netCents + f) / (1 - p));
}

/** The add-on a donor pays when they choose to cover processing. */
export function feeForAmount(netCents: number): number {
  return grossUpForFees(netCents) - netCents;
}

/** Stripe's actual cut on a given charge — reporting, not collection. */
export function estimatedStripeFee(chargedCents: number): number {
  const { percent: p, fixedCents: f } = stripeFeeRate();
  return Math.round(chargedCents * p) + f;
}

/** Disclosed platform fee. Basis points of the designated amount; 0 in v1. */
export function platformFeeFor(designatedCents: number, bps: number): number {
  return Math.round((designatedCents * bps) / 10_000);
}

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });
const usdWhole = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export function formatMoney(cents: number): string {
  return usd.format(cents / 100);
}

/** Drops the ".00" on round dollars — for headlines and progress bars. */
export function formatMoneyShort(cents: number): string {
  return cents % 100 === 0 ? usdWhole.format(cents / 100) : usd.format(cents / 100);
}

export function parseDollarsToCents(input: string): number | null {
  const cleaned = input.replace(/[^0-9.]/g, "");
  if (!cleaned) return null;
  const value = Number.parseFloat(cleaned);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(value * 100);
}

export const MIN_DONATION_CENTS = 500;
/** Blunts card-testing and fat fingers; raise for a known major gift. */
export const MAX_DONATION_CENTS = 2_500_000;
