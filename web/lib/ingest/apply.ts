/**
 * POST /api/apply/:jobId — PUBLIC candidate self-application.
 * - No session. Writes with the service role, server-side only, scoped to the job's company.
 * - Never returns data: success (including "already applied") is always {ok:true}.
 * - Rate limit: 5 requests per IP per hour, stored as a salted IP hash in apply_rate_limits
 *   (a table, not memory, because serverless instances don't share memory).
 */
import { createHash } from "node:crypto";
import { after } from "next/server";
import { z } from "zod";
import type { Json } from "../database.types";
import { createAdminClient } from "../supabase/admin";
import { applyAtsFilter } from "./ats";
import { type DB, UUID, json, jsonError } from "./http";
import { normalizePhone } from "./phone";
import { enrichCandidates } from "./resume";
import { checkResumeFile, plainText, resumePath, uploadResume } from "./storage";

export const APPLY_LIMIT = 5;
const WINDOW_MS = 60 * 60 * 1000;

const Fields = z.object({
  name: z.string().trim().min(1, "Enter your name").max(120),
  phone: z.string().trim().min(1, "Enter your phone number").max(40),
  email: z.union([z.literal(""), z.email("Enter a valid email").max(320)]).optional(),
  resume_text: z.string().max(60_000).optional(),
});

export function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  const first = xff?.split(",")[0]?.trim();
  return first || req.headers.get("x-real-ip")?.trim() || "unknown";
}

export function ipHash(ip: string) {
  const salt = process.env.RATE_LIMIT_SALT || process.env.SUPABASE_SERVICE_ROLE_KEY || "pingo";
  return createHash("sha256").update(`${salt}:${ip}`).digest("hex");
}

type RateDb = {
  from(t: "apply_rate_limits"): {
    insert(row: { ip_hash: string }): PromiseLike<{ error: unknown }>;
    select(
      cols: string,
      opts: { count: "exact"; head: true },
    ): { eq(c: string, v: string): { gte(c: string, v: string): PromiseLike<{ count: number | null; error: unknown }> } };
    delete(): { lt(c: string, v: string): PromiseLike<{ error: unknown }> };
  };
};

/** Records this attempt and returns true when the IP is over the limit. */
export async function overRateLimit(db: DB, ip: string): Promise<boolean> {
  const rdb = db as unknown as RateDb;
  const hash = ipHash(ip);
  const since = new Date(Date.now() - WINDOW_MS).toISOString();
  const ins = await rdb.from("apply_rate_limits").insert({ ip_hash: hash });
  if (ins.error) return true; // fail closed
  const { count, error } = await rdb.from("apply_rate_limits").select("id", { count: "exact", head: true }).eq("ip_hash", hash).gte("at", since);
  if (error) return true;
  if (Math.random() < 0.05) {
    await rdb.from("apply_rate_limits").delete().lt("at", new Date(Date.now() - 24 * WINDOW_MS).toISOString());
  }
  return (count ?? 0) > APPLY_LIMIT;
}

const isConsent = (v: unknown) => v === true || v === "true" || v === "on" || v === "1";

function runLater(task: () => Promise<unknown>) {
  const safe = () => task().catch(() => undefined);
  try {
    after(safe);
  } catch {
    void safe(); // outside a request scope (tests)
  }
}

export async function handleApply(req: Request, jobId: string): Promise<Response> {
  const db = createAdminClient() as unknown as DB;

  if (await overRateLimit(db, clientIp(req))) {
    return jsonError(429, "Too many applications from this network. Try again in an hour.");
  }

  let form: FormData | null = null;
  let obj: Record<string, unknown> = {};
  const type = req.headers.get("content-type") ?? "";
  try {
    if (type.includes("multipart/form-data") || type.includes("application/x-www-form-urlencoded")) {
      form = await req.formData();
      obj = Object.fromEntries([...form.entries()].filter(([, v]) => typeof v === "string"));
    } else {
      obj = (await req.json()) as Record<string, unknown>;
    }
  } catch {
    return jsonError(400, "Could not read the form");
  }
  if (!obj || typeof obj !== "object") return jsonError(400, "Could not read the form");

  // Honeypot: bots fill hidden fields. Pretend success, store nothing.
  if (typeof obj.website === "string" && obj.website.trim()) return json({ ok: true });

  if (!isConsent(obj.consent)) return jsonError(400, "Please agree to the data notice to apply");
  const parsed = Fields.safeParse(obj);
  if (!parsed.success) return jsonError(400, parsed.error.issues[0]?.message ?? "Check the form and try again");
  const phone = normalizePhone(parsed.data.phone);
  if (!phone.ok) return jsonError(400, "Enter a valid mobile number, e.g. +91 98765 43210");

  if (!UUID.test(jobId)) return jsonError(404, "This job is not accepting applications");
  const { data: job } = await db.from("jobs").select("id, company_id, title, jd_text, status").eq("id", jobId).maybeSingle();
  if (!job || job.status !== "open") return jsonError(404, "This job is not accepting applications");

  const resume = form?.get("resume");
  const file = resume instanceof File && resume.size > 0 ? resume : null;
  let ext: string | null = null;
  if (file) {
    const check = await checkResumeFile(file);
    if (!check.ok) return jsonError(400, `Resume: ${check.reason}`);
    ext = check.ext;
  }
  const text = (parsed.data.resume_text?.trim() || (file ? await plainText(file) : null) || "").slice(0, 20_000);

  const { data: inserted, error } = await db
    .from("candidates")
    .upsert(
      {
        company_id: job.company_id,
        job_id: job.id,
        name: parsed.data.name.replace(/\s+/g, " "),
        phone: phone.phone,
        email: parsed.data.email ? parsed.data.email.toLowerCase() : null,
        source: "form",
        consent_at: new Date().toISOString(),
        consent_source: "form",
        status: "imported",
        profile: text ? ({ resume_text: text } as Json) : null,
      },
      { onConflict: "job_id,phone", ignoreDuplicates: true },
    )
    .select("id");
  if (error) return jsonError(400, "Could not submit your application. Try again.");

  const candidateId = inserted?.[0]?.id;
  if (!candidateId) return json({ ok: true }); // already applied: same answer, no hint

  if (file && ext) {
    const path = resumePath(job.company_id, job.id, candidateId, ext);
    if (await uploadResume(db, path, file, ext)) {
      await db.from("candidates").update({ resume_path: path }).eq("id", candidateId).eq("company_id", job.company_id);
    }
  }

  if (text) {
    runLater(async () => {
      const [{ data: company }, { data: rubric }] = await Promise.all([
        db.from("companies").select("name").eq("id", job.company_id).maybeSingle(),
        db.from("rubrics").select("must_haves, nice_to_haves").eq("job_id", job.id).eq("is_current", true).maybeSingle(),
      ]);
      const texts = (v: unknown) =>
        (Array.isArray(v) ? v : []).map((m) => (m && typeof m === "object" && "text" in m ? String(m.text) : "")).filter(Boolean);
      await enrichCandidates(db, [{ id: candidateId, resume_text: text, resume_note: null }], {
        role: job.title,
        company: company?.name ?? undefined,
        jd_text: job.jd_text.slice(0, 4000),
        must_haves: texts(rubric?.must_haves),
        nice_to_haves: texts(rubric?.nice_to_haves),
      });
      await applyAtsFilter(job.id, db);
    });
  }

  return json({ ok: true });
}
