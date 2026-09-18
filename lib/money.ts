/**
 * Stripe's nonprofit rate, granted to verified 501(c)(3) organizations.
 * Apply at stripe.com/docs/nonprofit — until it is approved you are billed
 * the standard 2.9% + 30c, so keep these in sync with your actual rate or
 * the "cover the fee" option will under-collect by ~0.7%.
 */
export const STRIPE_PERCENT = 0.022;
export const STRIPE_FIXED_CENTS = 30;

/** What to charge so the team nets exactly `netCents` after Stripe. */
export function grossUpForFees(netCents: number): number {
  return Math.round((netCents + STRIPE_FIXED_CENTS) / (1 - STRIPE_PERCENT));
}

/** The add-on a donor pays when they choose to cover processing. */
export function feeForAmount(netCents: number): number {
  return grossUpForFees(netCents) - netCents;
}

/** Stripe's actual cut on a given charge — used for reporting, not collection. */
export function estimatedStripeFee(chargedCents: number): number {
  return Math.round(chargedCents * STRIPE_PERCENT) + STRIPE_FIXED_CENTS;
}

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
});

const usdWhole = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

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
/** Stripe caps a single card charge well above this; the limit is here to blunt
 *  card-testing and fat-finger entries, and can be raised for a major gift. */
export const MAX_DONATION_CENTS = 2_500_000;
