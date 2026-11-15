import { handleImport } from "@/lib/ingest/import";

// Resume reading (M3) runs inside the request for imported rows with resume text.
export const maxDuration = 300;

export async function POST(req: Request, ctx: RouteContext<"/api/jobs/[id]/candidates/import">) {
  const { id } = await ctx.params;
  return handleImport(req, id);
}
