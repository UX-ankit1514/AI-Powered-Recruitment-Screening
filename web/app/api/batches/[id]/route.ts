import { handleBatchProgress } from "@/lib/ingest/batches";

export async function GET(_req: Request, ctx: RouteContext<"/api/batches/[id]">) {
  const { id } = await ctx.params;
  return handleBatchProgress(id);
}
