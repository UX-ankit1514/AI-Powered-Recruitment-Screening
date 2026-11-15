import { NextResponse } from "next/server";
import { jsonError, readJson, requireUser, WRITE_ROLES, zodMessage } from "./_lib/auth";
import { JobCreateInput } from "./_lib/schemas";

const BALANCED = { skills: 30, experience: 30, culture_fit: 25, confidence: 15 };

/**
 * POST /api/jobs — create a job (+ rubric v1 on the Balanced preset) in the caller's company.
 * Only admins/recruiters. The company comes from the caller's membership, never from the body.
 */
export async function POST(req: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { supabase, userId } = auth;

  const body = await readJson(req);
  if (body === null) return jsonError(400, "Send a JSON body");
  const parsed = JobCreateInput.safeParse(body);
  if (!parsed.success) return jsonError(400, zodMessage(parsed.error));

  const { data: member } = await supabase
    .from("members")
    .select("company_id, role")
    .eq("user_id", userId)
    .in("role", [...WRITE_ROLES])
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!member) return jsonError(403, "Only admins and recruiters can create jobs");

  const { data: company } = await supabase.from("companies").select("culture_values, faq").eq("id", member.company_id).maybeSingle();

  const { data: job, error } = await supabase
    .from("jobs")
    .insert({
      company_id: member.company_id,
      title: parsed.data.title,
      jd_text: parsed.data.jd_text,
      ...(parsed.data.calling_hours ? { calling_hours: parsed.data.calling_hours } : {}),
      culture_values: company?.culture_values ?? [],
      faq: company?.faq ?? [],
    })
    .select("id, company_id, title, jd_text, status, calling_hours, languages, ats_mode, ats_top_pct, ats_rescue, created_at")
    .single();
  if (error || !job) return jsonError(error?.code === "42501" ? 403 : 500, "Could not create the job");

  const { error: rubricErr } = await supabase.from("rubrics").insert({
    job_id: job.id,
    company_id: job.company_id,
    version: 1,
    weights: BALANCED,
    is_current: true,
  });
  if (rubricErr) {
    await supabase.from("jobs").delete().eq("id", job.id);
    return jsonError(500, "Could not create the job");
  }

  return NextResponse.json({ job }, { status: 201 });
}
