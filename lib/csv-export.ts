/**
 * CSV for spreadsheets. A cell beginning with = + - @ or a tab/CR is evaluated
 * as a formula by Excel and Sheets — a donor "name" of =HYPERLINK(...) is an
 * attack on the treasurer's laptop. Strings with those prefixes get a leading
 * apostrophe; numbers pass through so negative amounts stay numeric.
 */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "yes" : "no";
  let s = value instanceof Date ? value.toISOString() : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  const lines = [headers.map(csvCell).join(","), ...rows.map((r) => r.map(csvCell).join(","))];
  return `${lines.join("\r\n")}\r\n`;
}
