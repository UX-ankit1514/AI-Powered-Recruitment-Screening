import { handleScreen } from "@/lib/calls/screen";

export const maxDuration = 60;

export async function POST(req: Request, ctx: RouteContext<"/api/jobs/[id]/screen">) {
  const { id } = await ctx.params;
  return handleScreen(req, id);
}
