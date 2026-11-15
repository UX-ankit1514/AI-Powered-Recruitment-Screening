import { handleErase } from "@/lib/retention/erase";

/** POST /api/candidates/:id/erase — delete-on-request, company admin only. Body: { "confirm": true }. */
export async function POST(req: Request, ctx: RouteContext<"/api/candidates/[id]/erase">) {
  const { id } = await ctx.params;
  return handleErase(req, id);
}
