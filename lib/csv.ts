/**
 * Contact CSV import. Lenient on shape — whatever a phone or spreadsheet
 * exports — strict on content: a row needs a name and at least one of a
 * plausible email or phone, and duplicates inside the file collapse.
 */
import Papa from "papaparse";
import { normalizeEmail, normalizePhone } from "./crypto";

export const MAX_CSV_BYTES = 1024 * 1024;
export const MAX_CSV_ROWS = 1000;

export type ParsedContact = { name: string; email: string | null; phone: string | null };
export type CsvParseResult = { contacts: ParsedContact[]; rowCount: number; skipped: number; errors: string[] };

const NAME = ["name", "full name", "fullname", "contact", "contact name", "display name"];
const FIRST = ["first", "first name", "firstname", "given name"];
const LAST = ["last", "last name", "lastname", "surname", "family name"];
const EMAIL = ["email", "e mail", "email address", "emailaddress", "mail", "e-mail"];
const PHONE = ["phone", "mobile", "cell", "phone number", "telephone", "tel", "mobile phone", "cell phone"];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function cleanEmail(v: string | undefined): string | null {
  const e = v?.trim();
  return e && EMAIL_RE.test(e) ? normalizeEmail(e) : null;
}
function cleanPhone(v: string | undefined): string | null {
  const digits = v?.replace(/\D/g, "") ?? "";
  return digits.length >= 10 && digits.length <= 15 ? normalizePhone(v!) : null;
}
function pick(headers: string[], candidates: string[]): string | undefined {
  return headers.find((h) => candidates.includes(h)) ?? headers.find((h) => candidates.some((c) => h.includes(c)));
}

export function parseContactsCsv(text: string): CsvParseResult {
  const errors: string[] = [];
  const headered = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim().toLowerCase().replace(/[_\-.]+/g, " ").replace(/\s+/g, " "),
  });

  const headers = headered.meta.fields ?? [];
  // First/last are detected first and excluded from the generic name match —
  // otherwise "first name" satisfies a fuzzy search for "name" and the surname is lost.
  const firstKey = pick(headers, FIRST);
  const lastKey = pick(headers, LAST);
  const nameKey = pick(headers.filter((h) => h !== firstKey && h !== lastKey), NAME);
  const emailKey = pick(headers, EMAIL);
  const phoneKey = pick(headers, PHONE);
  const recognised = Boolean(nameKey || firstKey || emailKey || phoneKey);

  let raw: ParsedContact[] = [];
  let rowCount = 0;

  if (recognised) {
    const rows = headered.data.slice(0, MAX_CSV_ROWS);
    rowCount = headered.data.length;
    raw = rows.map((r) => ({
      // `||` not `??`: an empty name cell should fall through to first + last.
      name: (r[nameKey ?? ""] || [r[firstKey ?? ""], r[lastKey ?? ""]].filter(Boolean).join(" ")).trim(),
      email: cleanEmail(r[emailKey ?? ""]),
      phone: cleanPhone(r[phoneKey ?? ""]),
    }));
  } else {
    // No usable header row: treat every row positionally. An @ is the email, a
    // run of 10+ digits is the phone, the first other non-empty cell is the name.
    const positional = Papa.parse<string[]>(text, { header: false, skipEmptyLines: "greedy" });
    rowCount = positional.data.length;
    raw = positional.data.slice(0, MAX_CSV_ROWS).map((cells) => {
      const trimmed = cells.map((c) => c.trim());
      const email = cleanEmail(trimmed.find((c) => c.includes("@")));
      const phone = cleanPhone(trimmed.find((c) => c.replace(/\D/g, "").length >= 10 && !c.includes("@")));
      const name = trimmed.find((c) => c && !c.includes("@") && c.replace(/\D/g, "").length < 7) ?? "";
      return { name, email, phone };
    });
  }

  if (rowCount > MAX_CSV_ROWS) errors.push(`Only the first ${MAX_CSV_ROWS} rows were read.`);

  const seen = new Set<string>();
  const contacts: ParsedContact[] = [];
  let skipped = 0;
  for (const c of raw) {
    if (!c.name || (!c.email && !c.phone)) {
      skipped += 1;
      continue;
    }
    const key = c.email ? `e:${c.email}` : `p:${c.phone}`;
    if (seen.has(key)) {
      skipped += 1;
      continue;
    }
    seen.add(key);
    contacts.push({ name: c.name.slice(0, 120), email: c.email, phone: c.phone });
  }

  return { contacts, rowCount, skipped, errors };
}
