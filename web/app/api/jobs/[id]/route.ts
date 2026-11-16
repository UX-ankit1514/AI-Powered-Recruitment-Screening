import { NextResponse } from "next/server";
import { applyAtsFilter, type AtsResult } from "@/lib/ingest/ats";
import { closeJob } from "@/lib/calls/cancel";
import type { DB } from "@/lib/ingest/http";
import { authorizeJob, jsonError, readJson, zodMessage } from "../_lib/auth";
import { JobUpdateInput } from "../_lib/schemas";

const JOB_COLUMNS =
  "id, company_id, title, jd_text, status, calling_hours, concurrency_limit, ats_mode, ats_top_pct, ats_rescue, languages, culture_values, faq, created_at";

/**
 * PUT /api/jobs/:id — update job details (admin/recruiter of the job's company).
 * Changing "who gets a call" re-applies it straight away (switching back to call_everyone
 * un-filters everyone). Setting status to closed also cancels waiting calls; booked callbacks stay.
 */
export async function PUT(req: Request, ctx: RouteContext<"/api/jobs/[id]">) {
  const { id } = await ctx.params;
  const auth = await authorizeJob(id, { write: true });
  if (!auth.ok) return auth.response;

  const body = await readJson(req);
  if (body === null) return jsonError(400, "Send a JSON body");
  const parsed = JobUpdateInput.safeParse(body);
  if (!parsed.success) return jsonError(400, zodMessage(parsed.error));

  const { data: before } = await auth.supabase.from("jobs").select("status").eq("id", auth.job.id).maybeSingle();
  const { data, error } = await auth.supabase
    .from("jobs")
    .update(parsed.data)
    .eq("id", auth.job.id)
    .eq("company_id", auth.job.company_id)
    .select(JOB_COLUMNS)
    .maybeSingle();
  if (error) return jsonError(500, "Could not save the job");
  if (!data) return jsonError(403, "Only admins and recruiters can change this job"); // RLS refused the write

  const db = auth.supabase as unknown as DB;
  if (parsed.data.status === "closed" && before?.status !== "closed") await closeJob(db, auth.job.id);

  let ats: AtsResult | null = null;
  if ("ats_mode" in parsed.data || "ats_top_pct" in parsed.data || "ats_rescue" in parsed.data) {
    try {
      ats = await applyAtsFilter(auth.job.id, db);
    } catch {
      ats = null;
    }
  }
  return NextResponse.json({ job: data, ats });
}
