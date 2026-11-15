import { handleAtsApply } from "@/lib/ingest/ats-route";

export async function POST(_req: Request, ctx: RouteContext<"/api/jobs/[id]/ats/apply">) {
  const { id } = await ctx.params;
  return handleAtsApply(id);
}
