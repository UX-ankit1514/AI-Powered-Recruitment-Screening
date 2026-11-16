import { NextResponse } from "next/server";
import { z } from "zod";
import { generateRoleProfile, AiError } from "@/lib/ai";
import { authorizeJob, jsonError, readJson, zodMessage } from "../../../_lib/auth";
import { saveRoleProfile } from "../../../_lib/role-profile";

export const maxDuration = 150;

const Empty = z.object({}).strict();

/**
 * POST /api/jobs/:id/role-profile/generate — AI drafts the role profile from the saved JD, culture
 * values and current rubric (must-haves, nice-to-haves, custom traits) and saves it as a new
 * version for HR to review and edit. Admin/recruiter only.
 */
export async function POST(req: Request, ctx: RouteContext<"/api/jobs/[id]/role-profile/generate">) {
  const { id } = await ctx.params;
  const auth = await authorizeJob(id, { write: true });
  if (!auth.ok) return auth.response;
  const parsed = Empty.safeParse((await readJson(req)) ?? {});
  if (!parsed.success) return jsonError(400, zodMessage(parsed.error));

  const [{ data: job }, { data: rubric }] = await Promise.all([
    auth.supabase.from("jobs").select("title, jd_text, culture_values").eq("id", auth.job.id).maybeSingle(),
    auth.supabase.from("rubrics").select("must_haves, nice_to_haves, custom_traits").eq("job_id", auth.job.id).eq("is_current", true).maybeSingle(),
  ]);
  if (!job) return jsonError(404, "Job not found");
  if (!job.jd_text.trim()) return jsonError(400, "Add the job description first");
  const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

  let draft: Awaited<ReturnType<typeof generateRoleProfile>>;
  try {
    draft = await generateRoleProfile({
      title: job.title,
      jdText: job.jd_text,
      cultureValues: arr(job.culture_values),
      mustHaves: arr(rubric?.must_haves),
      niceToHaves: arr(rubric?.nice_to_haves),
      customTraits: arr(rubric?.custom_traits),
    });
  } catch (err) {
    if (err instanceof AiError && err.kind === "config") return jsonError(503, "AI drafting is not configured on this server");
    return jsonError(502, "The AI could not draft the role profile right now. Try again in a minute.");
  }
  const { model_version, prompt_version, ...body } = draft;
  const saved = await saveRoleProfile(auth.supabase, auth.job.id, body, { source: "generated", model_version, prompt_version });
  if (!saved.ok) return saved.response;
  return NextResponse.json({ role_profile: saved.row }, { status: 201 });
}
