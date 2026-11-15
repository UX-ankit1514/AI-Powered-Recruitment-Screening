import { json, jsonError, requireMember, UUID_RE } from "@/components/results/server/auth";
import { loadProfile } from "@/components/results/server/data";

/** GET /api/candidates/:id (any member of the candidate's company; others get 404). */
export async function GET(_req: Request, ctx: RouteContext<"/api/candidates/[id]">) {
  const { id } = await ctx.params;
  const me = await requireMember();
  if (me instanceof Response) return me;
  if (!UUID_RE.test(id)) return jsonError(404, "Candidate not found");
  const p = await loadProfile(me.db, id, me.userId);
  if (!p) return jsonError(404, "Candidate not found");
  return json({
    candidate: p.candidate,
    job: p.job,
    pick: p.result.pick,
    scored_pick: p.result.scored_pick,
    override: p.result.override,
    overall: p.result.overall,
    held: p.result.held,
    score: p.score
      ? {
          ...p.score,
          qualities: p.result.qualities,
          must_have_results: p.result.must_have_results,
          flags: p.result.flags,
          resume_mismatch: p.result.mismatches,
          summary: p.result.summary,
          short_exit: p.result.short_exit,
        }
      : null,
    calls: p.calls,
    transcript: p.transcript,
    recording_signed_url: p.recording_signed_url,
    actions: p.actions,
  });
}
