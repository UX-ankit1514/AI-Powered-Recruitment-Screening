/**
 * POST /api/webhooks/bolna?secret=…  (bolna/app-agent.md §4)
 * Auth: constant-time secret + best-effort Bolna source IP. Every delivery is stored raw in
 * webhook_events, deduplicated on (execution id, status); a duplicate is acknowledged and ignored.
 * Processing (state, outcome, scoring, callbacks) runs after the 200 is sent.
 */
import { after } from "next/server";
import type { Json } from "../database.types";
import { createAdminClient } from "../supabase/admin";
import { scoreCall } from "../ai";
import { safeEqual, bolnaIpAllowed } from "./secret";
import { kickDispatcher } from "./kick";
import { bookCallback, CALL_COLS, endChainWithoutScore, finishCall, setCandidateStatus, bumpBatch, type CallRow, type DB } from "./lifecycle";
import { classifyTerminal, factsOf, liveState, TERMINAL_STATUSES, type BolnaExecution } from "./outcome";
import { cultureValuesOf, customTraitsOf, loadCallContext, mustHavesOf, resumeNoteOf } from "./context";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BODY = 2_000_000;

export type Defer = (task: () => Promise<unknown>) => void;
const defaultDefer: Defer = (task) => after(task);

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function handleBolnaWebhook(req: Request, defer: Defer = defaultDefer): Promise<Response> {
  const secret = new URL(req.url).searchParams.get("secret");
  if (!safeEqual(secret, process.env.BOLNA_WEBHOOK_SECRET)) return json({ error: "Unauthorized" }, 401);
  if (!bolnaIpAllowed(req)) return json({ error: "Forbidden" }, 403);

  const text = await req.text();
  if (text.length > MAX_BODY) return json({ error: "Payload too large" }, 413);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "Invalid payload" }, 400);
  const exec = body as BolnaExecution;
  const execId = typeof exec.id === "string" ? exec.id.slice(0, 100) : null;
  const status = typeof exec.status === "string" ? exec.status.slice(0, 50) : null;

  const db = createAdminClient();
  const { data: stored, error } = await db
    .from("webhook_events")
    .upsert({ bolna_execution_id: execId, status, payload: body as Json }, { onConflict: "bolna_execution_id,status", ignoreDuplicates: true })
    .select("id");
  if (error) return json({ error: "Could not store event" }, 500); // Bolna will retry
  if (!stored?.length) return json({ ok: true, duplicate: true });
  if (!execId || !status) return json({ ok: true, ignored: true });

  defer(async () => {
    try {
      await processExecution(db, exec);
    } catch (e) {
      console.error("bolna webhook processing failed", { execId, status, err: e instanceof Error ? e.message : "unknown" });
    }
  });
  return json({ ok: true });
}

async function findCall(db: DB, exec: BolnaExecution): Promise<CallRow | null> {
  const execId = String(exec.id);
  const { data: byExec } = await db.from("calls").select(CALL_COLS).eq("bolna_execution_id", execId).maybeSingle();
  if (byExec) return byExec;
  // Fallback: our call_id travels back in context_details.recipient_data (only for rows not yet linked).
  const callId = exec.context_details?.recipient_data?.call_id;
  if (typeof callId !== "string" || !UUID.test(callId)) return null;
  const { data: linked } = await db
    .from("calls")
    .update({ bolna_execution_id: execId })
    .eq("id", callId)
    .is("bolna_execution_id", null)
    .select(CALL_COLS)
    .maybeSingle();
  return linked ?? null;
}

export type ProcessResult = { handled: boolean; outcome?: string; scored?: boolean; rescheduled?: boolean };

/** Applies one execution snapshot to its call. Safe to call repeatedly (terminal work happens once). */
export async function processExecution(db: DB, exec: BolnaExecution, opts: { kick?: boolean } = {}): Promise<ProcessResult> {
  const call = await findCall(db, exec);
  if (!call) return { handled: false };
  const status = String(exec.status ?? "");

  if (!TERMINAL_STATUSES.has(status)) {
    const state = liveState(status);
    if (!state || call.state === "finished" || (call.state === "in_call" && state === "dialing")) return { handled: true };
    const startedAt = state === "in_call" && !call.started_at ? new Date().toISOString() : call.started_at;
    await db.from("calls").update({ state, locked_at: new Date().toISOString(), started_at: startedAt }).eq("id", call.id).neq("state", "finished");
    if (state === "in_call" || call.state === "queued") await setCandidateStatus(db, call.candidate_id, "calling", ["imported", "queued", "ats_filtered"]);
    return { handled: true };
  }

  const f = factsOf(exec);
  const booked = Boolean(call.callback_at); // reschedule_call booked a slot during this call
  const cls = classifyTerminal(f);
  const patch = {
    transcript: f.transcript || null,
    recording_url: f.recordingUrl,
    duration_s: f.durationSeconds,
    cost: f.costCents, // Bolna total_cost, in CENTS (USD), stored as given
    started_at: call.started_at ?? exec.initiated_at ?? exec.created_at ?? null,
    locked_at: null,
  };
  const finished = await finishCall(db, call.id, {
    outcome: booked ? "rescheduled" : cls.outcome,
    terminationReason: f.terminationReason ?? status,
    retry: booked ? false : cls.retry,
    patch,
  });
  if (!finished) return { handled: true }; // someone else finished it

  const kick = () => (opts.kick === false ? Promise.resolve() : kickDispatcher(call.job_id));
  if (booked) {
    await kick();
    return { handled: true, outcome: "rescheduled", rescheduled: true };
  }
  if (!cls.score) {
    if (!finished.retried) await endChainWithoutScore(db, finished.row);
    await kick();
    return { handled: true, outcome: cls.outcome };
  }

  // First scoring attempt happens here; a failure is retried by the dispatcher (retryPendingScores).
  const { data: claimed } = await db
    .from("calls")
    .update({ score_status: "scoring", score_attempts: 1, score_next_at: new Date().toISOString(), score_error: null })
    .eq("id", finished.row.id)
    .select(CALL_COLS)
    .maybeSingle();
  const row = claimed ?? finished.row;
  const callTime = exec.initiated_at ?? exec.created_at ?? row.started_at ?? row.created_at;
  try {
    const result = await scoreAndStore(db, row, callTime);
    await kick();
    return { handled: true, ...result };
  } catch (e) {
    await markScoreFailed(db, row, e);
    await kick();
    return { handled: true, outcome: row.outcome ?? cls.outcome, scored: false };
  }
}

/** Retry schedule after attempt n fails: 2 min, then 10 min. Attempt MAX_SCORE_ATTEMPTS gives up. */
export const MAX_SCORE_ATTEMPTS = 3;
const SCORE_BACKOFF_MIN = [2, 10];

async function markScoreFailed(db: DB, row: CallRow, e: unknown) {
  const attempts = Math.max(1, row.score_attempts ?? 1);
  const err = (e instanceof Error ? e.message : "unknown error").slice(0, 300);
  if (attempts >= MAX_SCORE_ATTEMPTS) {
    await db.from("calls").update({ score_status: "gave_up", score_error: err, score_next_at: null }).eq("id", row.id);
    await endChainWithoutScore(db, row);
    return;
  }
  const delay = SCORE_BACKOFF_MIN[Math.min(attempts - 1, SCORE_BACKOFF_MIN.length - 1)];
  await db
    .from("calls")
    .update({ score_status: "failed", score_error: err, score_next_at: new Date(Date.now() + delay * 60_000).toISOString() })
    .eq("id", row.id);
}

/**
 * Re-runs scoring for completed calls whose scoring failed or got stuck (claimed in SQL with
 * skip-locked, so parallel dispatchers never double-score). Called by the every-minute dispatcher.
 */
export async function retryPendingScores(db: DB, max = 3, jobId?: string): Promise<number> {
  const { data, error } = await db.rpc("claim_score_retries", {
    p_limit: max,
    p_max_attempts: MAX_SCORE_ATTEMPTS,
    ...(jobId ? { p_job_id: jobId } : {}),
  });
  if (error) return 0;
  let n = 0;
  for (const c of data ?? []) {
    const { data: row } = await db.from("calls").select(CALL_COLS).eq("id", c.call_id).maybeSingle();
    if (!row) continue;
    try {
      await scoreAndStore(db, row, row.started_at ?? row.created_at);
      n++;
    } catch (e) {
      await markScoreFailed(db, row, e);
    }
  }
  return n;
}

async function scoreAndStore(db: DB, row: CallRow, callTime: string): Promise<{ outcome: string; scored: boolean; rescheduled: boolean }> {
  const ctx = await loadCallContext(db, row.candidate_id);
  if (!ctx || !row.transcript) {
    await db.from("calls").update({ score_status: "gave_up", score_error: "no transcript or candidate context" }).eq("id", row.id);
    await endChainWithoutScore(db, row);
    return { outcome: row.outcome ?? "completed", scored: false, rescheduled: false };
  }
  // Idempotent: a retry after a late failure must not store a second score for the same call.
  const { count: already } = await db.from("scores").select("id", { count: "exact", head: true }).eq("call_id", row.id);
  if (already) {
    await db.from("calls").update({ score_status: "done", score_error: null, score_next_at: null }).eq("id", row.id);
    await setCandidateStatus(db, row.candidate_id, "scored");
    return { outcome: row.outcome ?? "completed", scored: true, rescheduled: false };
  }
  const score = await scoreCall({
    transcript: row.transcript,
    role: ctx.job.title,
    mustHaves: mustHavesOf(ctx),
    cultureValues: cultureValuesOf(ctx),
    openRoles: ctx.openRoles,
    resumeNote: resumeNoteOf(ctx),
    customTraits: customTraitsOf(ctx),
    candidateName: ctx.candidate.name,
    callTime,
  });

  const { error } = await db.from("scores").insert({
    call_id: row.id,
    candidate_id: row.candidate_id,
    company_id: row.company_id,
    rubric_version: ctx.rubric?.version ?? 0,
    qualities: score.qualities as unknown as Json,
    must_have_results: score.must_have_results as unknown as Json,
    flags: score.flags as unknown as Json,
    summary: score.summary,
    profile_updates: (score.profile_updates ?? null) as Json,
    short_exit: score.short_exit,
    model_version: score.model_version,
    prompt_version: score.prompt_version,
  });
  if (error) throw new Error("could not store score");
  await db.from("calls").update({ score_status: "done", score_error: null, score_next_at: null }).eq("id", row.id);

  let outcome = row.outcome ?? "completed";
  if (score.short_exit && outcome === "completed") {
    outcome = "short_exit";
    await db.from("calls").update({ outcome: "short_exit" }).eq("id", row.id);
  }
  await setCandidateStatus(db, row.candidate_id, "scored");

  let rescheduled = false;
  if (score.callback_requested_at) {
    const at = new Date(score.callback_requested_at);
    const when = at.getTime() < Date.now() + 5 * 60_000 ? new Date(Date.now() + 5 * 60_000) : at;
    const res = await bookCallback(db, row, when.toISOString(), { setQueued: false });
    if (res.ok) {
      rescheduled = true;
      outcome = "rescheduled";
    }
  }
  if (!rescheduled) await bumpBatch(db, row.batch_id);
  return { outcome, scored: true, rescheduled };
}

/**
 * Reaper for calls whose webhooks never arrived: polls Bolna for in-flight calls quiet for 20+ min
 * and applies the execution as if it were a webhook. After 60 min of silence the call is failed.
 */
export async function reapStaleCalls(db: DB, jobId?: string, max = 3): Promise<number> {
  let q = db
    .from("calls")
    .select(CALL_COLS)
    .in("state", ["dialing", "in_call"])
    .not("bolna_execution_id", "is", null)
    .lt("locked_at", new Date(Date.now() - 20 * 60_000).toISOString())
    .order("locked_at")
    .limit(max);
  if (jobId) q = q.eq("job_id", jobId);
  const { data: stale } = await q;
  let n = 0;
  const { getExecution } = await import("./bolna");
  for (const c of stale ?? []) {
    try {
      const exec = await getExecution(c.bolna_execution_id!);
      if (exec && TERMINAL_STATUSES.has(String(exec.status))) {
        await processExecution(db, { ...exec, id: c.bolna_execution_id! }, { kick: false });
        n++;
        continue;
      }
    } catch {
      // fall through to the age check
    }
    if (c.locked_at && Date.parse(c.locked_at) < Date.now() - 60 * 60_000) {
      const done = await finishCall(db, c.id, { outcome: "failed", terminationReason: "stale_no_webhook", retry: false });
      if (done) await endChainWithoutScore(db, done.row);
      n++;
    }
  }
  return n;
}
