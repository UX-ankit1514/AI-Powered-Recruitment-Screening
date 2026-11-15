import { handleApply } from "../../../../lib/ingest/apply";

export async function POST(req: Request, ctx: RouteContext<"/api/apply/[jobId]">) {
  const { jobId } = await ctx.params;
  return handleApply(req, jobId);
}
