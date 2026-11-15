/**
 * Small, dependency-free CSV reader (RFC 4180 style).
 * - quoted fields with commas, newlines and doubled quotes ("")
 * - CRLF / LF / CR line endings, UTF-8 BOM, blank lines dropped
 * - header row optional (detected by a "name" + "phone"/"mobile" column)
 */

export type CandidateCsvRow = {
  /** 1-based line number of the record in the file (header counts as line 1 when present). */
  row: number;
  name: string;
  phone: string;
  email?: string;
  resume_note?: string;
  resume_filename?: string;
  resume_text?: string;
  source?: string;
};

export function parseCsv(input: string): { cells: string[]; line: number }[] {
  const text = input.replace(/^﻿/, "");
  const out: { cells: string[]; line: number }[] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false; // inside quotes
  let wasQuoted = false; // field started with a quote (keeps inner whitespace)
  let line = 1;
  let rowLine = 1;

  const endField = () => {
    row.push(wasQuoted ? field : field.trim());
    field = "";
    wasQuoted = false;
  };
  const endRow = () => {
    endField();
    if (row.some((c) => c !== "")) out.push({ cells: row, line: rowLine });
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        if (ch === "\n") line++;
        field += ch;
      }
      continue;
    }
    if (ch === '"' && field.trim() === "" && !wasQuoted) {
      field = "";
      quoted = true;
      wasQuoted = true;
    } else if (ch === ",") {
      endField();
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      endRow();
      line++;
      rowLine = line;
    } else if (wasQuoted) {
      // text after a closing quote, e.g. "abc"def -> keep it, lenient
      if (ch.trim() !== "") field += ch;
    } else {
      field += ch;
    }
  }
  endRow();
  return out;
}

const key = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
const looksLikeEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

/** Turns CSV text into candidate rows. Header optional; without one: name, phone, [email], [note...]. */
export function parseCandidateCsv(text: string): CandidateCsvRow[] {
  const records = parseCsv(text);
  if (!records.length) return [];

  const head = records[0].cells.map(key);
  const find = (...names: string[]) => head.findIndex((h) => names.includes(h));
  const nameIdx = find("name", "fullname", "candidatename", "candidate");
  const phoneIdx = find("phone", "mobile", "phonenumber", "mobilenumber", "number", "contact");
  const hasHeader = nameIdx > -1 && phoneIdx > -1;

  if (hasHeader) {
    const emailIdx = find("email", "emailaddress", "mail");
    const fileIdx = find("resumefilename", "resumefile", "filename", "file", "resume");
    const noteIdx = head.findIndex((h, i) => i !== fileIdx && /note|summary/.test(h));
    const textIdx = find("resumetext");
    const sourceIdx = find("source");
    const get = (cells: string[], i: number) => (i > -1 ? (cells[i] ?? "").trim() : "");
    return records.slice(1).map(({ cells, line }) => {
      const r: CandidateCsvRow = { row: line, name: get(cells, nameIdx), phone: get(cells, phoneIdx) };
      const email = get(cells, emailIdx);
      if (email) r.email = email;
      const file = get(cells, fileIdx);
      if (file) r.resume_filename = file;
      const note = get(cells, noteIdx);
      if (note) r.resume_note = note;
      const rt = get(cells, textIdx);
      if (rt) r.resume_text = rt;
      const src = get(cells, sourceIdx);
      if (src) r.source = src;
      return r;
    });
  }

  return records.map(({ cells, line }) => {
    const [name = "", phone = "", ...rest] = cells;
    const r: CandidateCsvRow = { row: line, name: name.trim(), phone: phone.trim() };
    const extra = rest.map((s) => s.trim()).filter(Boolean);
    if (extra[0] && looksLikeEmail(extra[0])) r.email = extra.shift();
    if (extra.length) r.resume_note = extra.join(", ");
    return r;
  });
}
