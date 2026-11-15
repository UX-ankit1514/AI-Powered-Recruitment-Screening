import { NextResponse } from "next/server";
import { authorizeJob, jsonError, readJson, zodMessage } from "../../_lib/auth";
import { RubricInput } from "../../_lib/schemas";

const RUBRIC_COLUMNS = "id, job_id, company_id, version, must_haves, nice_to_haves, weights, custom_traits, is_current, created_by, created_at";

/**
 * PUT /api/jobs/:id/rubric — save the rubric as a NEW version and make it current.
 * Scores are never rewritten: overall/pick are computed at read time from the current weights.
 *
 * Atomic: public.save_rubric_version() inserts version N+1 and retires the old current version
 * in ONE database transaction (security invoker, so RLS applies; serialised per job).
 */
export async function PUT(req: Request, ctx: RouteContext<"/api/jobs/[id]/rubric">) {
  const { id } = await ctx.params;
  const auth = await authorizeJob(id, { write: true });
  if (!auth.ok) return auth.response;
  const { supabase, job } = auth;

  const body = await readJson(req);
  if (body === null) return jsonError(400, "Send a JSON body");
  const parsed = RubricInput.safeParse(body);
  if (!parsed.success) return jsonError(400, zodMessage(parsed.error));
  const input = parsed.data;

  const { data, error } = await supabase.rpc("save_rubric_version", {
    p_job_id: job.id,
    p_must_haves: input.must_haves,
    p_nice_to_haves: input.nice_to_haves,
    p_weights: input.weights,
    p_custom_traits: input.custom_traits,
  });
  if (error) {
    if (error.code === "42501") return jsonError(403, "Only admins and recruiters can change this job");
    if (error.code === "P0002") return jsonError(404, "Job not found");
    if (error.code === "23505") return jsonError(409, "Someone saved this rubric at the same time. Reload and try again.");
    return jsonError(500, "Could not save the rubric");
  }
  const saved = Array.isArray(data) ? data[0] : data;
  if (!saved) return jsonError(500, "Could not save the rubric");
  const rubric = Object.fromEntries(RUBRIC_COLUMNS.split(", ").map((k) => [k, (saved as Record<string, unknown>)[k]]));
  return NextResponse.json({ rubric });
}
