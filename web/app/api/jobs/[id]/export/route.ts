import { canWrite, jsonError, requireMember, roleIn, UUID_RE } from "@/components/results/server/auth";
import { loadRanking } from "@/components/results/server/data";
import { rowsToCsv } from "@/components/results/model";
import { RUBRIC_PRESETS } from "@/lib/types";

/**
 * GET /api/jobs/:id/export?preset= — ranked CSV (admin/recruiter only; hiring managers 403,
 * other companies 404). Optional preset ranks by a preset's weights instead of the saved rubric.
 */
export async function GET(req: Request, ctx: RouteContext<"/api/jobs/[id]/export">) {
  const { id } = await ctx.params;
  const me = await requireMember();
  if (me instanceof Response) return me;
  if (!UUID_RE.test(id)) return jsonError(404, "Job not found");

  const { data: job } = await me.db.from("jobs").select("id, company_id").eq("id", id).maybeSingle();
  if (!job) return jsonError(404, "Job not found");
  const role = await roleIn(me.db, me.userId, job.company_id);
  if (!role) return jsonError(404, "Job not found");
  if (!canWrite(role)) return jsonError(403, "Only admins and recruiters can export candidates");

  const presetId = new URL(req.url).searchParams.get("preset");
  const preset = presetId ? RUBRIC_PRESETS.find((p) => p.id === presetId) : undefined;
  if (presetId && !preset) return jsonError(400, "Unknown preset");

  const r = await loadRanking(me.db, id, preset ? { weights: preset.weights as Record<string, number> } : {});
  if (!r) return jsonError(404, "Job not found");
  const slug = r.job.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "job";
  return new Response(rowsToCsv(r.rows, r.qualities), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="pingo-${slug}-ranking.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
