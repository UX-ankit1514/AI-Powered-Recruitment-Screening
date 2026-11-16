/**
 * Pairs applicant rows with resume files dropped next to them (batch panel). Pure, unit-tested.
 *  1. A row's resume_filename column (CSV) matches a file of that name (case-insensitive, any folder).
 *  2. Otherwise a file whose name contains every part of the applicant's name
 *     ("Riya Sharma" ↔ "riya_sharma_CV.pdf", "Sharma Riya resume.docx"), when exactly one file fits.
 * Each file is used once. Manual per-row choices are applied on top by the caller.
 */

export type MatchRow = { key: string; name: string; resume_filename?: string | null };

const base = (fileName: string) => fileName.split(/[\\/]/).pop()!.trim().toLowerCase();
const words = (s: string) =>
  s
    .toLowerCase()
    .replace(/\.[a-z0-9]{2,5}$/, "")
    .split(/[^a-zÀ-ɏऀ-ॿ]+/)
    .filter((w) => w.length >= 2);

export function fileKey(fileName: string): string {
  return base(fileName);
}

export function matchResumes(rows: MatchRow[], fileNames: string[]): Map<string, string> {
  const out = new Map<string, string>();
  const free = new Map(fileNames.map((f) => [base(f), f]));

  for (const r of rows) {
    if (!r.resume_filename) continue;
    const k = base(r.resume_filename);
    const hit = free.get(k);
    if (hit) {
      out.set(r.key, hit);
      free.delete(k);
    }
  }

  const fileWords = () => [...free.entries()].map(([k, f]) => ({ k, f, w: new Set(words(k)) }));
  for (const r of rows) {
    if (out.has(r.key)) continue;
    const need = words(r.name);
    if (!need.length) continue;
    const fits = fileWords().filter((x) => need.every((w) => x.w.has(w)));
    if (fits.length === 1) {
      out.set(r.key, fits[0].f);
      free.delete(fits[0].k);
    }
  }
  return out;
}
