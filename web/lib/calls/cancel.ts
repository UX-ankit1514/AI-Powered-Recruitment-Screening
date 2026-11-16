/**
 * Cancelling calls that have not started yet (Stop batch, Close job, Reject candidate).
 * Runs on the caller's RLS-bound client: only admins/recruiters of the company can delete call
 * rows, so a refused write simply cancels nothing. Calls already dialling or on the line are
 * never touched; they finish normally (and cannot retry once their batch is stopped).
 *
 * Booked callbacks (`scheduled`) are promises made to a candidate, so they are kept unless the
 * caller explicitly asks to cancel them too.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../database.types";

type DB = SupabaseClient<Database>;
export type CancelScope = { batchId?: string; jobId?: string; candidateId?: string };

export async function cancelQueuedCalls(
  db: DB,
  scope: CancelScope,
  opts: { includeCallbacks?: boolean } = {},
): Promise<{ cancelled: number; candidateIds: string[]; error: string | null }> {
  if (!scope.batchId && !scope.jobId && !scope.candidateId) return { cancelled: 0, candidateIds: [], error: null };
  let q = db.from("calls").delete().eq("state", "queued");
  if (scope.batchId) q = q.eq("batch_id", scope.batchId);
  if (scope.jobId) q = q.eq("job_id", scope.jobId);
  if (scope.candidateId) q = q.eq("candidate_id", scope.candidateId);
  if (!opts.includeCallbacks) q = q.eq("scheduled", false);
  const { data, error } = await q.select("candidate_id");
  if (error) return { cancelled: 0, candidateIds: [], error: error.code ?? "error" };
  const candidateIds = [...new Set((data ?? []).map((r) => r.candidate_id))];
  return { cancelled: (data ?? []).length, candidateIds, error: null };
}

/** Candidates whose waiting call was cancelled go back to "imported" (unless they still have one queued). */
export async function releaseCandidates(db: DB, candidateIds: string[]) {
  if (!candidateIds.length) return;
  const { data: still } = await db.from("calls").select("candidate_id").in("candidate_id", candidateIds).in("state", ["queued", "dialing", "in_call"]);
  const busy = new Set((still ?? []).map((r) => r.candidate_id));
  const free = candidateIds.filter((id) => !busy.has(id));
  for (let i = 0; i < free.length; i += 200) {
    await db.from("candidates").update({ status: "imported" }).in("id", free.slice(i, i + 200)).eq("status", "queued");
  }
}

/** Booked callbacks still waiting, for the Stop / Close confirmations. */
export async function countCallbacks(db: DB, scope: { batchId?: string; jobId?: string }): Promise<number> {
  let q = db.from("calls").select("id", { count: "exact", head: true }).eq("state", "queued").eq("scheduled", true);
  if (scope.batchId) q = q.eq("batch_id", scope.batchId);
  if (scope.jobId) q = q.eq("job_id", scope.jobId);
  const { count } = await q;
  return count ?? 0;
}

/**
 * Closes a job: status closed, waiting calls cancelled, running batches stopped.
 * Booked callbacks are kept (the dispatcher still makes them) unless `cancelCallbacks`.
 */
export async function closeJob(db: DB, jobId: string, opts: { cancelCallbacks?: boolean } = {}) {
  const { data: job, error } = await db.from("jobs").update({ status: "closed" }).eq("id", jobId).select("id").maybeSingle();
  if (error || !job) return { ok: false as const, error: error?.code ?? "not_found" };
  const res = await cancelQueuedCalls(db, { jobId }, { includeCallbacks: opts.cancelCallbacks });
  await releaseCandidates(db, res.candidateIds);
  await db.from("batches").update({ status: "stopped" }).eq("job_id", jobId).in("status", ["queued", "running"]);
  const kept = opts.cancelCallbacks ? 0 : await countCallbacks(db, { jobId });
  return { ok: true as const, cancelled: res.cancelled, callbacks_kept: kept };
}
