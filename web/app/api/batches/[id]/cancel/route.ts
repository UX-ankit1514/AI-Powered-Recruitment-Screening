import { UUID, WRITE_ROLES, json, jsonError, requireJobRole, requireSession } from "@/lib/ingest/http";

/**
 * POST /api/batches/:id/cancel (admin/recruiter) — "Stop": removes the batch's calls that are
 * still waiting in the queue. Calls already dialling or on a call finish normally. Cancelled
 * candidates go back to "imported" so they can be called later. RLS applies to every write.
 */
export async function POST(_req: Request, ctx: RouteContext<"/api/batches/[id]/cancel">) {
  const { id } = await ctx.params;
  const session = await requireSession();
  if (session instanceof Response) return session;
  if (!UUID.test(id)) return jsonError(404, "Batch not found");

  const { data: batch } = await session.supabase.from("batches").select("id, job_id, status").eq("id", id).maybeSingle();
  if (!batch) return jsonError(404, "Batch not found");
  const auth = await requireJobRole(batch.job_id, WRITE_ROLES);
  if (auth instanceof Response) return auth;
  const db = auth.supabase;

  const { data: removed, error } = await db.from("calls").delete().eq("batch_id", id).eq("state", "queued").select("candidate_id");
  if (error) return jsonError(error.code === "42501" ? 403 : 400, "Could not stop the batch");
  const ids = [...new Set((removed ?? []).map((r) => r.candidate_id))];
  for (let i = 0; i < ids.length; i += 200) {
    await db.from("candidates").update({ status: "imported" }).in("id", ids.slice(i, i + 200)).eq("status", "queued");
  }
  await db.from("batches").update({ status: "stopped" }).eq("id", id);
  return json({ cancelled: ids.length, status: "stopped" });
}
