/** Pure unit tests: CSV reader, phone normalisation, row prep/dedupe, ATS split. No network. */
import { describe, expect, it } from "vitest";
import { computeAtsSplit } from "../../lib/ingest/ats";
import { parseCandidateCsv, parseCsv } from "../../lib/ingest/csv";
import { normalizePhone } from "../../lib/ingest/phone";
import { prepareRows } from "../../lib/ingest/rows";

describe("parseCsv", () => {
  it("handles quoted commas, escaped quotes and embedded newlines", () => {
    const rows = parseCsv('name,note\n"Rao, Priya","said ""hi""\nthen left"\n');
    expect(rows.map((r) => r.cells)).toEqual([
      ["name", "note"],
      ["Rao, Priya", 'said "hi"\nthen left'],
    ]);
  });

  it("drops blank and whitespace-only lines, handles CRLF, CR and BOM", () => {
    const rows = parseCsv("﻿a,b\r\n\r\n , \r\nc,d\re,f");
    expect(rows.map((r) => r.cells)).toEqual([
      ["a", "b"],
      ["c", "d"],
      ["e", "f"],
    ]);
  });

  it("trims unquoted fields but keeps whitespace inside quotes", () => {
    expect(parseCsv('  x  ," y "')[0].cells).toEqual(["x", " y "]);
  });

  it("keeps empty trailing fields and a missing final newline", () => {
    expect(parseCsv("a,,c,")[0].cells).toEqual(["a", "", "c", ""]);
  });

  it("reports the source line of each record (multi-line quoted fields counted)", () => {
    const rows = parseCsv('h\n"a\nb"\n\nc');
    expect(rows.map((r) => r.line)).toEqual([1, 2, 5]);
  });
});

describe("parseCandidateCsv", () => {
  it("maps a header in any order and case", () => {
    const rows = parseCandidateCsv("Phone,Email,Full Name,Resume Filename,Resume note\n9876543210,a@b.co,Asha,asha.pdf,2y sales\n");
    expect(rows).toEqual([
      { row: 2, name: "Asha", phone: "9876543210", email: "a@b.co", resume_filename: "asha.pdf", resume_note: "2y sales" },
    ]);
  });

  it("accepts 'mobile' as the phone column", () => {
    expect(parseCandidateCsv("name,mobile\nRavi,+919812345678")[0]).toMatchObject({ name: "Ravi", phone: "+919812345678" });
  });

  it("works without a header: name, phone, [email], note...", () => {
    const rows = parseCandidateCsv("Asha,9876543210,asha@x.in,B.Com, 2 years edtech\nRavi,9812345678,inside sales\n\n");
    expect(rows).toEqual([
      { row: 1, name: "Asha", phone: "9876543210", email: "asha@x.in", resume_note: "B.Com, 2 years edtech" },
      { row: 2, name: "Ravi", phone: "9812345678", resume_note: "inside sales" },
    ]);
  });

  it("returns [] for an empty or blank file", () => {
    expect(parseCandidateCsv("")).toEqual([]);
    expect(parseCandidateCsv("\n\n  \n")).toEqual([]);
  });

  it("header-only file has no rows", () => {
    expect(parseCandidateCsv("name,phone\n")).toEqual([]);
  });
});

describe("normalizePhone", () => {
  const ok = (raw: string, phone: string) => expect(normalizePhone(raw)).toEqual({ ok: true, phone });
  const bad = (raw: unknown) => expect(normalizePhone(raw).ok).toBe(false);

  it("defaults 10-digit numbers to +91", () => ok("9876543210", "+919876543210"));
  it("strips spaces, dashes, dots and brackets", () => ok("(+91) 98765-43.210", "+919876543210"));
  it("handles 0-prefixed and 91-prefixed Indian numbers", () => {
    ok("09876543210", "+919876543210");
    ok("919876543210", "+919876543210");
    ok("+91 0 98765 43210", "+919876543210");
  });
  it("handles 00 international prefix", () => ok("0044 7911 123456", "+447911123456"));
  it("keeps valid international E.164", () => ok("+1 555 010 0123", "+15550100123"));
  it("rejects non-mobile Indian numbers", () => {
    bad("1234567890");
    bad("+91 5876543210");
  });
  it("rejects garbage, letters, too short/long and empty", () => {
    bad("");
    bad(null);
    bad("call me");
    bad("98765abc10");
    bad("12345");
    bad("+1234567890123456");
    bad("98765432101");
  });
});

describe("prepareRows", () => {
  it("normalises, validates, dedupes within the file and reports rows", () => {
    const res = prepareRows([
      { name: "Asha", phone: "9876543210", email: "ASHA@X.IN" },
      { name: "Asha again", phone: "+91 98765 43210" },
      { name: "", phone: "9812345678" },
      { name: "Bad", phone: "12345" },
      { name: "Ravi", phone: 9812345678, email: "not-an-email" },
    ]);
    expect(res.duplicates).toBe(1);
    expect(res.invalid).toEqual([
      { row: 3, reason: "missing name" },
      { row: 4, reason: expect.any(String) },
    ]);
    expect(res.valid.map((r) => [r.name, r.phone, r.email, r.source])).toEqual([
      ["Asha", "+919876543210", "asha@x.in", "csv"],
      ["Ravi", "+919812345678", null, "csv"],
    ]);
  });

  it("uses the CSV line number when present and keeps a safe source", () => {
    const res = prepareRows([{ row: 7, name: "A", phone: "x" }, { row: 8, name: "B", phone: "9876543210", source: "Portal Mock" }]);
    expect(res.invalid[0].row).toBe(7);
    expect(res.valid[0].source).toBe("portal_mock");
  });
});

describe("computeAtsSplit", () => {
  const cands = [95, 90, 85, 80, 75, 70, 65, 60, 55, 50].map((s, i) => ({ id: `c${i}`, resume_only_score: s }));
  cands.push({ id: "noscore", resume_only_score: null as unknown as number });

  it("call_everyone filters nobody", () => {
    expect(computeAtsSplit(cands, { ats_mode: "call_everyone", ats_top_pct: 30, ats_rescue: true }).filtered.size).toBe(0);
  });

  it("keeps the top pct, rescues within 10 points of the cutoff, never filters unscored", () => {
    const r = computeAtsSplit(cands, { ats_mode: "ats_filter", ats_top_pct: 30, ats_rescue: true });
    expect(r.cutoff).toBe(85);
    expect([...r.rescued].sort()).toEqual(["c3", "c4"]);
    expect([...r.filtered].sort()).toEqual(["c5", "c6", "c7", "c8", "c9"]);
    expect(r.filtered.has("noscore")).toBe(false);
  });

  it("without rescue filters everyone below the cutoff; ties with the cutoff are kept", () => {
    const tie = [...cands, { id: "tie", resume_only_score: 85 }];
    const r = computeAtsSplit(tie, { ats_mode: "ats_filter", ats_top_pct: 30, ats_rescue: false });
    expect(r.filtered.has("tie")).toBe(false);
    expect(r.filtered.size).toBe(7);
  });
});
