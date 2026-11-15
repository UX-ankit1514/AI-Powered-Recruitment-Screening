/** Call row transitions shared by the dispatcher, webhook and reschedule endpoint. Service role only. */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../database.types";
import { MAX_ATTEMPTS, MAX_RESCHEDULES, RETRY_DELAY_MIN } from "./config";
import type { CallOutcome } from "./outcome";

export type DB = SupabaseClient<Database>;
export type CallRow = Database["public"]["Tables"]["calls"]["Row"];

/** For RPCs not in the generated types. */
export const untyped = (db: DB) => db as unknown as SupabaseClient;

export const CALL_COLS =
  "id, candidate_id, job_id, company_id, batch_id, attempt, due_at, state, outcome, bolna_execution_id, started_at, duration_s, recording_url, transcript, cost, termination_reason, reschedule_count, locked_at, callback_at, scheduled, call_kind, created_at, score_status, score_attempts, score_next_at, score_error";

/** Moves a candidate's status, never touching shortlisted / rejected (a human decided). */
export async function setCandidateStatus(db: DB, candidateId: string, status: string, onlyFrom?: string[]) {
  let q = db.from("candidates").update({ status }).eq("id", candidateId).not("status", "in", "(shortlisted,rejected)");
  if (onlyFrom?.length) q = q.in("status", onlyFrom);
  await q;
}

export async function bumpBatch(db: DB, batchId: string | null) {
  if (batchId) await untyped(db).rpc("bump_batch_done", { p_batch_id: batchId });
}

export type FinishInput = {
  outcome: CallOutcome;
  terminationReason?: string | null;
  retry?: boolean;
  patch?: Partial<Database["public"]["Tables"]["calls"]["Update"]>;
};

/**
 * Finishes a call exactly once (only the caller that flips state → finished gets true).
 * Retryable outcomes requeue a new attempt at +30 min while attempts remain.
 * Returns the finished row, or null if another worker already finished it.
 */
export async function finishCall(db: DB, callId: string, f: FinishInput): Promise<{ row: CallRow; retried: boolean } | null> {
  const { data: row } = await db
    .from("calls")
    .update({
      ...f.patch,
      state: "finished",
      outcome: f.outcome,
      termination_reason: f.terminationReason ?? f.patch?.termination_reason ?? null,
    })
    .eq("id", callId)
    .neq("state", "finished")
    .select(CALL_COLS)
    .maybeSingle();
  if (!row) return null;

  const retried = Boolean(f.retry) && row.attempt < MAX_ATTEMPTS;
  if (retried) {
    await db.from("calls").insert({
      candidate_id: row.candidate_id,
      job_id: row.job_id,
      company_id: row.company_id,
      batch_id: row.batch_id,
      attempt: row.attempt + 1,
      reschedule_count: row.reschedule_count,
      due_at: new Date(Date.now() + RETRY_DELAY_MIN * 60_000).toISOString(),
      state: "queued",
      call_kind: "phone",
    });
    await setCandidateStatus(db, row.candidate_id, "queued");
  }
  return { row, retried };
}

/** Final state of a candidate's call chain with no score: back to 'imported' so a recruiter can retry. */
export async function endChainWithoutScore(db: DB, row: Pick<CallRow, "candidate_id" | "batch_id">) {
  await setCandidateStatus(db, row.candidate_id, "imported", ["queued", "calling"]);
  await bumpBatch(db, row.batch_id);
}

/**
 * Queues the callback call for `row` at `at` (ISO). Refuses when a booking already exists for
 * this call (callback_at set) or the reschedule cap is reached. Marks the original 'rescheduled'
 * and records callback_at (so a later completed webhook keeps that outcome).
 */
export async function bookCallback(
  db: DB,
  row: Pick<CallRow, "id" | "candidate_id" | "job_id" | "company_id" | "batch_id" | "reschedule_count" | "callback_at">,
  at: string,
  opts: { setQueued?: boolean } = {},
): Promise<{ ok: true; callId: string } | { ok: false; reason: string }> {
  if (row.callback_at) return { ok: false, reason: "a callback is already booked for this call" };
  if (row.reschedule_count >= MAX_RESCHEDULES) return { ok: false, reason: "reschedule limit reached" };

  // Claim the booking on the original row first (atomic: only one booking per call).
  const { data: claimed } = await db
    .from("calls")
    .update({ callback_at: at })
    .eq("id", row.id)
    .is("callback_at", null)
    .lt("reschedule_count", MAX_RESCHEDULES)
    .select("id")
    .maybeSingle();
  if (!claimed) return { ok: false, reason: "a callback is already booked for this call" };

  const { data: created, error } = await db
    .from("calls")
    .insert({
      candidate_id: row.candidate_id,
      job_id: row.job_id,
      company_id: row.company_id,
      batch_id: row.batch_id,
      attempt: 1,
      reschedule_count: row.reschedule_count + 1,
      due_at: at,
      scheduled: true,
      state: "queued",
      call_kind: "phone",
    })
    .select("id")
    .single();
  if (error || !created) {
    await db.from("calls").update({ callback_at: null }).eq("id", row.id);
    return { ok: false, reason: "could not save the booking" };
  }
  await db.from("calls").update({ outcome: "rescheduled" }).eq("id", row.id);
  if (opts.setQueued !== false) await setCandidateStatus(db, row.candidate_id, "queued");
  return { ok: true, callId: created.id };
}
