/**
 * Deployment branding. The organization row holds legal identity for receipts;
 * this is the team identity the public pages wear.
 */
export const brand = {
  name: "UNC Hockey",
  tagline: "Carolina Club Hockey",
  /** Full lockup: interlocking NC over HOCKEY. Carolina blue on transparent — use on navy. */
  logo: "/brand/unc-hockey-logo.png",
  /** Square mark for the header and favicon. */
  mark: "/brand/unc-hockey-mark.png",
} as const;

/** "Junior" stays "Junior"; a bare year becomes "Class of 2028". */
export function classYearLabel(value: string | null | undefined): string | null {
  if (!value) return null;
  return /^\d{4}$/.test(value) ? `Class of ${value}` : value;
}
