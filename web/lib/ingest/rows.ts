import { z } from "zod";
import { normalizePhone } from "./phone";

export const IncomingRowSchema = z.object({
  name: z.string().max(200).optional().default(""),
  phone: z.union([z.string(), z.number()]).optional().default(""),
  email: z.string().max(320).nullish(),
  resume_note: z.string().max(2000).nullish(),
  resume_text: z.string().max(60_000).nullish(),
  resume_filename: z.string().max(300).nullish(),
  source: z.string().max(40).nullish(),
});
export type IncomingRow = z.input<typeof IncomingRowSchema> & { row?: number };

export type PreparedRow = {
  row: number;
  name: string;
  phone: string;
  email: string | null;
  resume_note: string | null;
  resume_text: string | null;
  resume_filename: string | null;
  source: string;
};

export type InvalidRow = { row: number; reason: string };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SOURCE = /^[a-z][a-z0-9_]{0,39}$/;
const clean = (s: string | null | undefined, max: number) => {
  const v = String(s ?? "").replace(/\s+/g, " ").trim().slice(0, max);
  return v || null;
};

/**
 * Validates, normalises and de-duplicates rows (within the file) before they touch the DB.
 * `row` defaults to the 1-based position in the array.
 */
export function prepareRows(rows: IncomingRow[], defaultSource = "csv") {
  const valid: PreparedRow[] = [];
  const invalid: InvalidRow[] = [];
  const seen = new Set<string>();
  let duplicates = 0;

  rows.forEach((raw, i) => {
    const rowNo = typeof raw.row === "number" ? raw.row : i + 1;
    const parsed = IncomingRowSchema.safeParse(raw);
    if (!parsed.success) {
      invalid.push({ row: rowNo, reason: "row has invalid fields" });
      return;
    }
    const r = parsed.data;
    const name = clean(r.name, 120);
    if (!name) {
      invalid.push({ row: rowNo, reason: "missing name" });
      return;
    }
    const ph = normalizePhone(r.phone);
    if (!ph.ok) {
      invalid.push({ row: rowNo, reason: ph.reason });
      return;
    }
    if (seen.has(ph.phone)) {
      duplicates++;
      return;
    }
    seen.add(ph.phone);
    const email = clean(r.email, 320);
    const src = clean(r.source, 40)?.toLowerCase().replace(/[^a-z0-9_]/g, "_") ?? null;
    valid.push({
      row: rowNo,
      name,
      phone: ph.phone,
      email: email && EMAIL.test(email) ? email.toLowerCase() : null,
      resume_note: clean(r.resume_note, 500),
      resume_text: r.resume_text?.trim() ? r.resume_text.trim().slice(0, 20_000) : null,
      resume_filename: clean(r.resume_filename, 300),
      source: src && SOURCE.test(src) ? src : defaultSource,
    });
  });

  return { valid, invalid, duplicates };
}
