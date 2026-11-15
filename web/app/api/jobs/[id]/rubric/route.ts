import { NextResponse } from "next/server";
import { authorizeJob, jsonError, readJson, zodMessage } from "../../_lib/auth";
import { RubricInput } from "../../_lib/schemas";

const RUBRIC_COLUMNS = "id, job_id, company_id, version, must_haves, nice_to_haves, weights, custom_traits, is_current, created_by, created_at";

/**
 * PUT /api/jobs/:id/rubric — save the rubric as a NEW version and make it current.
 * Scores are never rewritten: overall/pick are computed at read time from the current weights.
 *
 * Sequence (no multi-statement transaction over PostgREST):
 *   1. insert version N+1 with is_current=false  (unique (job_id, version) turns a race into a 409)
 *   2. retire the previous current version
 *   3. promote N+1; if that fails, restore the previous version so the job always has a rubric.
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

  const { data: latest, error: latestErr } = await supabase
    .from("rubrics")
    .select("id, version, is_current")
    .eq("job_id", job.id)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latestErr) return jsonError(500, "Could not load the rubric");
  const { data: current } = await supabase.from("rubrics").select("id").eq("job_id", job.id).eq("is_current", true).maybeSingle();

  const nextVersion = (latest?.version ?? 0) + 1;
  const { data: inserted, error: insErr } = await supabase
    .from("rubrics")
    .insert({
      job_id: job.id,
      company_id: job.company_id,
      version: nextVersion,
      must_haves: input.must_haves,
      nice_to_haves: input.nice_to_haves,
      weights: input.weights,
      custom_traits: input.custom_traits,
      is_current: false,
    })
    .select("id")
    .single();
  if (insErr || !inserted) {
    if (insErr?.code === "23505") return jsonError(409, "Someone saved this rubric at the same time. Reload and try again.");
    if (insErr?.code === "42501") return jsonError(403, "Only admins and recruiters can change this job");
    return jsonError(500, "Could not save the rubric");
  }

  if (current) {
    const { error } = await supabase.from("rubrics").update({ is_current: false }).eq("id", current.id);
    if (error) {
      await supabase.from("rubrics").delete().eq("id", inserted.id);
      return jsonError(500, "Could not save the rubric");
    }
  }

  const { data: promoted, error: promErr } = await supabase
    .from("rubrics")
    .update({ is_current: true })
    .eq("id", inserted.id)
    .select(RUBRIC_COLUMNS)
    .single();
  if (promErr || !promoted) {
    if (current) await supabase.from("rubrics").update({ is_current: true }).eq("id", current.id);
    await supabase.from("rubrics").delete().eq("id", inserted.id);
    return jsonError(500, "Could not save the rubric");
  }

  return NextResponse.json({ rubric: promoted });
}
