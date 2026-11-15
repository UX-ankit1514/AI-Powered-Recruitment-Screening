import { NextResponse } from "next/server";
import { authorizeJob, jsonError } from "../../_lib/auth";
import { loadBiasSummary } from "@/components/fairness/server/load";

/**
 * GET /api/jobs/:id/bias — bias watch summary for one job.
 * Any member of the job's company (admin, recruiter, hiring manager) may read it.
 * 401 signed out · 404 malformed id or another company's job (RLS hides it) · 200 summary JSON.
 */
export async function GET(_req: Request, ctx: RouteContext<"/api/jobs/[id]/bias">) {
  const { id } = await ctx.params;
  const auth = await authorizeJob(id, { write: false });
  if (!auth.ok) return auth.response;
  try {
    const summary = await loadBiasSummary(auth.supabase, id);
    if (!summary) return jsonError(404, "Job not found");
    return NextResponse.json(summary, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return jsonError(500, "Could not build the bias summary");
  }
}
