import { json, jsonError, requireMember, UUID_RE } from "@/components/results/server/auth";
import { loadRanking } from "@/components/results/server/data";

/** GET /api/jobs/:id/ranking?rubric_version= (any member; other companies get 404). */
export async function GET(req: Request, ctx: RouteContext<"/api/jobs/[id]/ranking">) {
  const { id } = await ctx.params;
  const me = await requireMember();
  if (me instanceof Response) return me;
  if (!UUID_RE.test(id)) return jsonError(404, "Job not found");
  const v = new URL(req.url).searchParams.get("rubric_version");
  const version = v ? Number(v) : undefined;
  if (v && (!Number.isInteger(version) || (version as number) < 1)) return jsonError(400, "rubric_version must be a positive whole number");
  const r = await loadRanking(me.db, id, { rubricVersion: version });
  if (!r) return jsonError(404, "Job not found");
  if (version && r.rubric?.version !== version) return jsonError(404, "That rubric version does not exist");
  return json({
    job: { id: r.job.id, title: r.job.title },
    rubric_version: r.rubric?.version ?? null,
    weights: r.rubric?.weights ?? {},
    rows: r.rows,
  });
}
