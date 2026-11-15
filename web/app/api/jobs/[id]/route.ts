import { NextResponse } from "next/server";
import { authorizeJob, jsonError, readJson, zodMessage } from "../_lib/auth";
import { JobUpdateInput } from "../_lib/schemas";

const JOB_COLUMNS =
  "id, company_id, title, jd_text, status, calling_hours, concurrency_limit, ats_mode, ats_top_pct, ats_rescue, languages, culture_values, faq, created_at";

/** PUT /api/jobs/:id — update job details (admin/recruiter of the job's company). */
export async function PUT(req: Request, ctx: RouteContext<"/api/jobs/[id]">) {
  const { id } = await ctx.params;
  const auth = await authorizeJob(id, { write: true });
  if (!auth.ok) return auth.response;

  const body = await readJson(req);
  if (body === null) return jsonError(400, "Send a JSON body");
  const parsed = JobUpdateInput.safeParse(body);
  if (!parsed.success) return jsonError(400, zodMessage(parsed.error));

  const { data, error } = await auth.supabase
    .from("jobs")
    .update(parsed.data)
    .eq("id", auth.job.id)
    .eq("company_id", auth.job.company_id)
    .select(JOB_COLUMNS)
    .maybeSingle();
  if (error) return jsonError(500, "Could not save the job");
  if (!data) return jsonError(403, "Only admins and recruiters can change this job"); // RLS refused the write
  return NextResponse.json({ job: data });
}
