/**
 * POST /api/batches (admin/recruiter): queue calls for a job's imported candidates.
 * GET  /api/batches/:id (any member): progress.
 * The dispatcher (M6) dials queued calls; this module only creates them.
 */
import { z } from "zod";
import { ANY_ROLE, UUID, WRITE_ROLES, json, jsonError, requireJobRole, requireSession } from "./http";

const Body = z.object({
  job_id: z.string().regex(UUID),
  candidate_ids: z.array(z.string().regex(UUID)).min(1).max(5000).optional(),
});

export async function handleCreateBatch(req: Request): Promise<Response> {
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
  const rows = ids.map((candidate_id) => ({
    candidate_id,
    job_id: job.id,
    company_id: job.company_id,
    batch_id: batch.id,
    state: "queued" as const,
    due_at: now,
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
    .select("candidate_id, attempt, state, outcome")
    .eq("batch_id", batchId)
    .limit(10_000);
  if (error) return jsonError(400, "Could not load calls");

  // Retries add new call rows for the same candidate: count each candidate's latest attempt.
  const latest = new Map<string, { attempt: number; state: string; outcome: string | null }>();
  for (const c of calls ?? []) {
    const prev = latest.get(c.candidate_id);
    if (!prev || c.attempt > prev.attempt) latest.set(c.candidate_id, c);
  }
  const progress = { total: latest.size, queued: 0, in_flight: 0, done: 0, outcomes: {} as Record<string, number> };
  for (const c of latest.values()) {
    if (c.state === "queued") progress.queued++;
    else if (c.state === "dialing" || c.state === "in_call") progress.in_flight++;
    else progress.done++;
    if (c.outcome) progress.outcomes[c.outcome] = (progress.outcomes[c.outcome] ?? 0) + 1;
  }
  return json({ batch: { id: batch.id, job_id: batch.job_id, status: batch.status, created_at: batch.created_at }, ...progress });
}
