/**
 * POST /api/jobs/:id/candidates/import (admin/recruiter).
 * JSON:      { rows: [{name, phone, email?, resume_note?, resume_text?, source?}], consent_confirmed: true }
 * Multipart: csv (file), resumes / resumes[] (files, matched to the CSV's resume_filename column),
 *            resume_texts (optional JSON {filename: text} extracted in the browser),
 *            consent_confirmed=true
 * Every write goes through the caller's RLS-bound client (no service role here).
 */
import { z } from "zod";
import type { Json } from "../database.types";
import { applyAtsFilter, type AtsResult } from "./ats";
import { parseCandidateCsv } from "./csv";
import { type DB, type JobRow, WRITE_ROLES, json, jsonError, requireJobRole } from "./http";
import { enrichCandidates, type EnrichTarget, type ResumeContext } from "./resume";
import { type IncomingRow, type InvalidRow, prepareRows } from "./rows";
import { checkResumeFile, plainText, resumePath, uploadResume } from "./storage";

export const MAX_ROWS = 2000;
const MAX_CSV_BYTES = 2 * 1024 * 1024;

const JsonBody = z.object({
  rows: z.array(z.record(z.string(), z.unknown())).min(1).max(MAX_ROWS),
  consent_confirmed: z.literal(true),
});

type Parsed = { rows: IncomingRow[]; files: Map<string, File>; texts: Map<string, string> };

const isConsent = (v: unknown) => v === true || v === "true" || v === "on" || v === "1";

async function readBody(req: Request): Promise<Parsed | Response> {
  const type = req.headers.get("content-type") ?? "";
  if (type.includes("multipart/form-data")) {
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return jsonError(400, "Could not read the upload");
    }
    if (!isConsent(form.get("consent_confirmed"))) {
      return jsonError(400, "Confirm the candidates agreed to be contacted (consent_confirmed=true)");
    }
    const csv = form.get("csv");
    if (!(csv instanceof File)) return jsonError(400, "Attach a CSV file in the 'csv' field");
    if (csv.size > MAX_CSV_BYTES) return jsonError(400, "CSV is over 2 MB");
    const rows = parseCandidateCsv(await csv.text());
    if (!rows.length) return jsonError(400, "The CSV has no rows");
    if (rows.length > MAX_ROWS) return jsonError(400, `At most ${MAX_ROWS} rows per import`);

    const files = new Map<string, File>();
    for (const f of [...form.getAll("resumes"), ...form.getAll("resumes[]")]) {
      if (f instanceof File && f.name) files.set(f.name.trim().toLowerCase(), f);
    }
    const texts = new Map<string, string>();
    const rawTexts = form.get("resume_texts");
    if (typeof rawTexts === "string" && rawTexts.trim()) {
      try {
        const obj = z.record(z.string(), z.string()).parse(JSON.parse(rawTexts));
        for (const [k, v] of Object.entries(obj)) texts.set(k.trim().toLowerCase(), v.slice(0, 20_000));
      } catch {
        return jsonError(400, "resume_texts must be a JSON object of file name to text");
      }
    }
    return { rows, files, texts };
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "Body must be JSON or multipart form data");
  }
  const parsed = JsonBody.safeParse(body);
  if (!parsed.success) {
    const consentMissing = parsed.error.issues.some((i) => i.path[0] === "consent_confirmed");
    return jsonError(
      400,
      consentMissing
        ? "Confirm the candidates agreed to be contacted (consent_confirmed: true)"
        : `Send 1 to ${MAX_ROWS} rows as {rows:[{name, phone, ...}]}`,
    );
  }
  return { rows: parsed.data.rows as IncomingRow[], files: new Map(), texts: new Map() };
}

async function resumeContext(db: DB, job: JobRow): Promise<ResumeContext> {
  const [{ data: company }, { data: rubric }] = await Promise.all([
    db.from("companies").select("name").eq("id", job.company_id).maybeSingle(),
    db.from("rubrics").select("must_haves, nice_to_haves").eq("job_id", job.id).eq("is_current", true).maybeSingle(),
  ]);
  const texts = (v: unknown) =>
    (Array.isArray(v) ? v : [])
      .map((m) => (typeof m === "string" ? m : m && typeof m === "object" && "text" in m ? String((m as { text: unknown }).text) : ""))
      .filter(Boolean);
  return {
    role: job.title,
    company: company?.name ?? undefined,
    jd_text: job.jd_text.slice(0, 4000),
    must_haves: texts(rubric?.must_haves),
    nice_to_haves: texts(rubric?.nice_to_haves),
  };
}

export type ImportResult = {
  imported: number;
  duplicates: number;
  invalid: InvalidRow[];
  candidate_ids: string[];
  resumes_uploaded: number;
  resumes_read: number;
  resume_issues: InvalidRow[];
  ats: AtsResult | null;
};

export async function handleImport(req: Request, jobId: string): Promise<Response> {
  const auth = await requireJobRole(jobId, WRITE_ROLES);
  if (auth instanceof Response) return auth;
  const { supabase: db, job } = auth;

  const body = await readBody(req);
  if (body instanceof Response) return body;

  const { valid, invalid, duplicates: fileDupes } = prepareRows(body.rows, "csv");
  const now = new Date().toISOString();
  const resumeIssues: InvalidRow[] = [];

  // Resume text from the browser (per file name) or a .txt resume, if the row has none.
  for (const r of valid) {
    if (r.resume_text || !r.resume_filename) continue;
    const key = r.resume_filename.toLowerCase();
    const fromBrowser = body.texts.get(key);
    const file = body.files.get(key);
    r.resume_text = fromBrowser?.trim() || (file ? await plainText(file) : null);
  }

  const toInsert = valid.map((r) => {
    const profile: Record<string, string> = {};
    if (r.resume_note) profile.resume_note = r.resume_note;
    if (r.resume_text) profile.resume_text = r.resume_text;
    return {
      company_id: job.company_id,
      job_id: job.id,
      name: r.name,
      phone: r.phone,
      email: r.email,
      source: r.source,
      consent_at: now,
      consent_source: "employer_upload",
      status: "imported",
      profile: Object.keys(profile).length ? (profile as Json) : null,
    };
  });

  const inserted: { id: string; phone: string }[] = [];
  for (let i = 0; i < toInsert.length; i += 500) {
    const { data, error } = await db
      .from("candidates")
      .upsert(toInsert.slice(i, i + 500), { onConflict: "job_id,phone", ignoreDuplicates: true })
      .select("id, phone");
    if (error) return jsonError(error.code === "42501" ? 403 : 400, "Could not save candidates");
    inserted.push(...(data ?? []));
  }
  const byPhone = new Map(inserted.map((c) => [c.phone, c.id]));
  const duplicates = fileDupes + (valid.length - inserted.length);

  // Resume files -> private bucket, path <company>/<job>/<candidate>/resume.<ext>
  let uploaded = 0;
  for (const r of valid) {
    const id = byPhone.get(r.phone);
    if (!id || !r.resume_filename) continue;
    const file = body.files.get(r.resume_filename.toLowerCase());
    if (!file) {
      if (body.files.size) resumeIssues.push({ row: r.row, reason: "resume file not attached" });
      continue;
    }
    const check = await checkResumeFile(file);
    if (!check.ok) {
      resumeIssues.push({ row: r.row, reason: check.reason });
      continue;
    }
    const path = resumePath(job.company_id, job.id, id, check.ext);
    if (!(await uploadResume(db, path, file, check.ext))) {
      resumeIssues.push({ row: r.row, reason: "resume upload failed" });
      continue;
    }
    await db.from("candidates").update({ resume_path: path }).eq("id", id);
    uploaded++;
  }

  const targets: EnrichTarget[] = valid
    .filter((r) => r.resume_text && byPhone.has(r.phone))
    .map((r) => ({ id: byPhone.get(r.phone)!, resume_text: r.resume_text!, resume_note: r.resume_note }));
  const read = targets.length ? await enrichCandidates(db, targets, await resumeContext(db, job)) : 0;

  let ats: AtsResult | null = null;
  try {
    ats = await applyAtsFilter(job.id, db);
  } catch {
    ats = null;
  }

  const result: ImportResult = {
    imported: inserted.length,
    duplicates,
    invalid,
    candidate_ids: inserted.map((c) => c.id),
    resumes_uploaded: uploaded,
    resumes_read: read,
    resume_issues: resumeIssues,
    ats,
  };
  return json(result);
}
