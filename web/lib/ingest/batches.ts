/**
 * POST /api/batches (admin/recruiter): queue calls for a job's imported candidates.
 * GET  /api/batches/:id (any member): progress.
 * The dispatcher (M6) dials queued calls. Starting a batch nudges it (and the heads-up sender)
 * straight away instead of waiting for the next every-minute run. While calling is on, batch calls
 * are queued 2 minutes ahead so each candidate gets their heads-up message before the phone rings.
 */
import { after } from "next/server";
import { z } from "zod";
import { HEADS_UP_LEAD_MS, dispatchEnabled } from "../calls/config";
import { kickDispatcher } from "../calls/kick";
import { ANY_ROLE, UUID, WRITE_ROLES, json, jsonError, requireJobRole, requireSession } from "./http";

export type Kick = (jobId: string) => void;

/** Runs after the response: heads-up messages first, then the dispatcher. Never throws. */
const defaultKick: Kick = (jobId) => {
  const run = async () => {
    try {
      const { runSweep } = await import("../messaging/heads-up");
      await runSweep({ jobId });
    } catch {
      // the every-minute sweep is the backstop
    }
    await kickDispatcher(jobId);
  };
  try {
    after(run);
  } catch {
    // outside a request (scripts, tests): the every-minute cron picks the calls up
  }
};

const Body = z.object({
  job_id: z.string().regex(UUID),
  candidate_ids: z.array(z.string().regex(UUID)).min(1).max(5000).optional(),
});

export async function handleCreateBatch(req: Request, kick: Kick = defaultKick): Promise<Response> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    raw = null;
  }
  // Auth before validation detail, so anonymous callers learn nothing.
  const session = await requireSession();
  if (session instanceof Response) return session;
  const parsed = Body.safeParse(raw);
  if (!parsed.success) return jsonError(400, "Send {job_id, candidate_ids?}");

  const auth = await requireJobRole(parsed.data.job_id, WRITE_ROLES);
  if (auth instanceof Response) return auth;
  const { supabase: db, job } = auth;

  let q = db.from("candidates").select("id").eq("job_id", job.id).eq("status", "imported");
  if (parsed.data.candidate_ids) q = q.in("id", [...new Set(parsed.data.candidate_ids)]);
  const { data: cands, error } = await q.limit(5000);
  if (error) return jsonError(400, "Could not load candidates");
  const ids = (cands ?? []).map((c) => c.id);
  if (!ids.length) return jsonError(409, "No candidates ready to call (imported, not ATS-filtered, not already queued)");

  const { data: batch, error: bErr } = await db
    .from("batches")
    .insert({ job_id: job.id, company_id: job.company_id, total: ids.length, status: "queued" })
    .select("id")
    .single();
  if (bErr || !batch) return jsonError(400, "Could not create the batch");

  const now = new Date().toISOString();
  const dueAt = dispatchEnabled() ? new Date(Date.now() + HEADS_UP_LEAD_MS).toISOString() : now;
  const rows = ids.map((candidate_id) => ({
    candidate_id,
    job_id: job.id,
    company_id: job.company_id,
    batch_id: batch.id,
    state: "queued" as const,
    due_at: dueAt,
    attempt: 1,
  }));
  for (let i = 0; i < rows.length; i += 500) {
    const { error: cErr } = await db.from("calls").insert(rows.slice(i, i + 500));
    if (cErr) {
      await db.from("calls").delete().eq("batch_id", batch.id);
      await db.from("batches").delete().eq("id", batch.id);
      return jsonError(400, "Could not queue the calls");
    }
  }
  for (let i = 0; i < ids.length; i += 200) {
    await db.from("candidates").update({ status: "queued" }).in("id", ids.slice(i, i + 200)).eq("status", "imported");
  }
  if (!job.screening_started_at) {
    await db.from("jobs").update({ screening_started_at: now }).eq("id", job.id).is("screening_started_at", null);
  }

  kick(job.id);
  return json({ batch_id: batch.id, queued: ids.length }, 201);
}

export async function handleBatchProgress(batchId: string): Promise<Response> {
  const session = await requireSession();
  if (session instanceof Response) return session;
  if (!UUID.test(batchId)) return jsonError(404, "Batch not found");
  const db = session.supabase;

  const { data: batch } = await db
    .from("batches")
    .select("id, job_id, company_id, status, total, created_at")
    .eq("id", batchId)
    .maybeSingle();
  if (!batch) return jsonError(404, "Batch not found");
  const auth = await requireJobRole(batch.job_id, ANY_ROLE);
  if (auth instanceof Response) return auth;

  const { data: calls, error } = await db
    .from("calls")
    .select("candidate_id, attempt, state, outcome, scheduled, created_at")
    .eq("batch_id", batchId)
    .order("created_at", { ascending: true })
    .limit(10_000);
  if (error) return jsonError(400, "Could not load calls");

  const { latest, callbacks } = summariseBatchCalls(calls ?? []);
  const progress = { total: latest.size, queued: 0, in_flight: 0, done: 0, callbacks, outcomes: {} as Record<string, number> };
  for (const c of latest.values()) {
    if (c.state === "queued") progress.queued++;
    else if (c.state === "dialing" || c.state === "in_call") progress.in_flight++;
    else progress.done++;
    if (c.outcome) progress.outcomes[c.outcome] = (progress.outcomes[c.outcome] ?? 0) + 1;
  }
  return json({ batch: { id: batch.id, job_id: batch.job_id, status: batch.status, created_at: batch.created_at }, ...progress });
}

type BatchCall = { candidate_id: string; attempt: number; state: string; outcome: string | null; scheduled: boolean; created_at: string };

/**
 * Each candidate's newest call row decides their progress. Retries and booked callbacks add rows
 * (a callback starts again at attempt 1), so "newest" is by creation time, never by attempt.
 * `callbacks` = booked callbacks still waiting to be made.
 */
export function summariseBatchCalls(calls: BatchCall[]) {
  const latest = new Map<string, BatchCall>();
  let callbacks = 0;
  for (const c of calls) {
    const prev = latest.get(c.candidate_id);
    if (!prev || c.created_at >= prev.created_at) latest.set(c.candidate_id, c);
    if (c.scheduled && c.state === "queued") callbacks++;
  }
  return { latest, callbacks };
}
