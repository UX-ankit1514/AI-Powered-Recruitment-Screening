import { handleCandidateAction } from "@/components/results/server/actions";

/** POST /api/candidates/:id/actions — note (any member) or shortlist/reject/override/move_to_job (admin, recruiter). */
export async function POST(req: Request, ctx: RouteContext<"/api/candidates/[id]/actions">) {
  const { id } = await ctx.params;
  return handleCandidateAction(req, id);
}
