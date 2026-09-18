/** j***@unc.edu — enough for an admin to recognise an invite, not enough to leak it. */
export function maskEmail(email: string): string {
  const [local = "", domain = ""] = email.split("@");
  if (!domain) return "***";
  return `${local.slice(0, 1)}***@${domain}`;
}
