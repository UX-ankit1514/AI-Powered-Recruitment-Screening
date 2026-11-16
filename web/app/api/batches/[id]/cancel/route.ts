import { z } from "zod";
import { cancelQueuedCalls, countCallbacks, releaseCandidates } from "@/lib/calls/cancel";
import { UUID, WRITE_ROLES, json, jsonError, requireJobRole, requireSession } from "@/lib/ingest/http";

const Body = z.object({ cancel_callbacks: z.boolean().optional() }).catch({});

/**
 * POST /api/batches/:id/cancel (admin/recruiter) — "Stop": the batch is marked stopped first (so no
 * call of it can retry or be picked up again), then its waiting calls are removed. Calls already
 * dialling or on a call finish normally. Booked callbacks are promises to a candidate and are kept
 * unless { cancel_callbacks: true }. Cancelled candidates go back to "imported". RLS applies.
 */
export async function POST(req: Request, ctx: RouteContext<"/api/batches/[id]/cancel">) {
  const { id } = await ctx.params;
  const session = await requireSession();
  if (session instanceof Response) return session;
  if (!UUID.test(id)) return jsonError(404, "Batch not found");

  const { data: batch } = await session.supabase.from("batches").select("id, job_id, status").eq("id", id).maybeSingle();
  if (!batch) return jsonError(404, "Batch not found");
  const auth = await requireJobRole(batch.job_id, WRITE_ROLES);
  if (auth instanceof Response) return auth;
  const db = auth.supabase;
  const { cancel_callbacks } = Body.parse(await req.json().catch(() => ({})));

  const { error: stopErr } = await db.from("batches").update({ status: "stopped" }).eq("id", id);
  if (stopErr) return jsonError(stopErr.code === "42501" ? 403 : 400, "Could not stop the batch");
  const res = await cancelQueuedCalls(db, { batchId: id }, { includeCallbacks: cancel_callbacks === true });
  if (res.error) return jsonError(res.error === "42501" ? 403 : 400, "Could not stop the batch");
  await releaseCandidates(db, res.candidateIds);
  const kept = cancel_callbacks === true ? 0 : await countCallbacks(db, { batchId: id });
  return json({ cancelled: res.candidateIds.length, callbacks_kept: kept, status: "stopped" });
}
