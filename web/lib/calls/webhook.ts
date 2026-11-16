/**
 * POST /api/webhooks/bolna?secret=…  (bolna/app-agent.md §4)
 * Auth: constant-time secret + best-effort Bolna source IP. Every delivery is stored raw in
 * webhook_events, deduplicated on (execution id, status); a duplicate is acknowledged and ignored.
 * Processing (state, outcome, scoring, callbacks) runs after the 200 is sent; a delivery is marked
 * processed_at only when that succeeds. Failed or lost processing is retried by the dispatcher's
 * stale sweep (reprocessUnprocessedEvents) and when Bolna re-sends the same delivery.
 */
import { after } from "next/server";
import type { Json } from "../database.types";
import { createAdminClient } from "../supabase/admin";
import { scoreCall, classifyCall, heuristicClass, outcomeForClass, type ClassifyResult } from "../ai";
import { safeEqual, bolnaIpAllowed } from "./secret";
import { kickDispatcher } from "./kick";
import { bookCallback, CALL_COLS, endChainWithoutScore, finishCall, setCandidateStatus, bumpBatch, type CallRow, type DB } from "./lifecycle";
import { classifyTerminal, factsOf, liveState, TERMINAL_STATUSES, type BolnaExecution } from "./outcome";
import { cultureValuesOf, customTraitsOf, loadCallContext, mustHavesOf, niceToHavesOf, resumeNoteOf } from "./context";
import { untyped } from "./lifecycle";
import { languageMix } from "../fairness/groups";

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
  if (!execId || !status) {
    if (stored?.[0]) await markEvent(db, stored[0].id, null);
    return json({ ok: true, ignored: true });
  }
  let eventId = stored?.[0]?.id ?? null;
  if (eventId === null) {
    // Duplicate delivery. If the first one never finished processing (crash, timeout) and is not
    // still in flight (2+ min old), process it now instead of dropping it.
    const { data: prev } = await db
      .from("webhook_events")
      .select("id, processed_at, received_at")
      .eq("bolna_execution_id", execId)
      .eq("status", status)
      .maybeSingle();
    if (!prev || prev.processed_at || Date.parse(prev.received_at) > Date.now() - 2 * 60_000) return json({ ok: true, duplicate: true });
    eventId = prev.id;
  }
  const id = eventId;
  defer(async () => {
    await runEvent(db, id, exec);
  });
  return json({ ok: true });
}

/** Processes one stored delivery and records the result on its webhook_events row. */
async function runEvent(db: DB, eventId: number, exec: BolnaExecution, opts: { kick?: boolean } = {}): Promise<boolean> {
  try {
    await processExecution(db, exec, opts);
    await markEvent(db, eventId, null);
    return true;
  } catch (e) {
    const err = e instanceof Error ? e.message : "unknown";
    console.error("bolna webhook processing failed", { execId: exec.id, status: exec.status, err });
    await markEvent(db, eventId, err);
    return false;
  }
}

async function markEvent(db: DB, eventId: number, err: string | null) {
  await untyped(db)
    .from("webhook_events")
    .update(err === null ? { processed_at: new Date().toISOString(), last_error: null } : { last_error: err.slice(0, 300) })
    .eq("id", eventId);
}

/**
 * Re-runs deliveries whose processing failed or never finished (claimed in SQL with skip-locked,
 * 3+ min old, max 5 attempts). Called from the dispatcher's stale sweep. processExecution is
 * idempotent: terminal work happens once.
 */
export async function reprocessUnprocessedEvents(db: DB, max = 5): Promise<number> {
  const { data, error } = await untyped(db).rpc("claim_unprocessed_webhook_events", { p_limit: max });
  if (error) return 0;
  let n = 0;
  for (const ev of (data ?? []) as { event_id: number; payload: unknown }[]) {
    const exec = ev.payload as BolnaExecution;
    if (!exec || typeof exec !== "object" || typeof exec.id !== "string") {
      await markEvent(db, ev.event_id, null);
      continue;
    }
    if (await runEvent(db, ev.event_id, exec, { kick: false })) n++;
  }
  return n;
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
  let cls = classifyTerminal(f);
  // Bolna said "a conversation happened"; check it was really the candidate (voicemail greetings and
  // family members show up as user lines too). Non-conversations are not scored and are retried.
  let callClass: ClassifyResult | null = null;
  if (!booked && cls.score && f.transcript.trim()) {
    callClass = await classifyForWebhook(f.transcript, exec.initiated_at ?? exec.created_at ?? null);
    if (callClass && callClass.cls !== "conversation") {
      const o = outcomeForClass(callClass.cls);
      cls = { outcome: o.outcome, retry: o.retry, score: false };
    }
  }
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
    const result = await scoreAndStore(db, row, callTime, callClass);
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

/**
 * Webhook-time call classification. Uses the model when available; if the gateway is down, falls
 * back to the confident heuristics only (an unclear call is treated as a conversation and the
 * scorer classifies it again when it runs).
 */
async function classifyForWebhook(transcript: string, callTime: string | null): Promise<ClassifyResult | null> {
  try {
    return await classifyCall({ transcript, role: "the role", callTime });
  } catch {
    const h = heuristicClass(transcript);
    if (h.confident && h.cls !== "conversation") {
      return { cls: h.cls, reason: h.reason, shortExit: false, conductEnded: false, gaming: false, callbackAt: null, usedModel: false, model: null };
    }
    return null;
  }
}

/** Seconds below which a call counts as cut short for callback booking. */
export const CUT_OFF_SECONDS = 240;

/**
 * A callback requested in the transcript is booked only for short / cut-off calls (execution
 * review #9): never after a full, scored conversation, a planned short exit or a conduct end.
 */
export function callbackAllowed(
  score: { short_exit: boolean; conduct_ended: boolean; coverage?: Record<string, string> | null; requirement_scores?: Record<string, { importance: string }> | null },
  row: { outcome: string | null; duration_s: number | null },
): boolean {
  if (score.conduct_ended || score.short_exit) return false;
  if (row.outcome === "dropped") return true;
  if (typeof row.duration_s === "number" && row.duration_s > 0 && row.duration_s < CUT_OFF_SECONDS) return true;
  // Long call that still never got to most must/core requirements (e.g. line kept breaking).
  const reqs = Object.entries(score.requirement_scores ?? {}).filter(([, r]) => r.importance !== "nice");
  if (score.coverage && reqs.length) {
    const asked = reqs.filter(([id]) => score.coverage?.[id] && score.coverage[id] !== "not_asked").length;
    return asked / reqs.length < 0.5;
  }
  return false;
}

async function scoreAndStore(
  db: DB,
  row: CallRow,
  callTime: string,
  known: ClassifyResult | null = null,
): Promise<{ outcome: string; scored: boolean; rescheduled: boolean }> {
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
    niceToHaves: niceToHavesOf(ctx),
    cultureValues: cultureValuesOf(ctx),
    openRoles: ctx.openRoles,
    resumeNote: resumeNoteOf(ctx),
    customTraits: customTraitsOf(ctx),
    candidateName: ctx.candidate.name,
    callTime,
    roleProfile: ctx.roleProfile ?? null,
    knownClass:
      known && known.cls === "conversation" && known.usedModel
        ? { cls: "conversation", shortExit: known.shortExit, conductEnded: known.conductEnded, gaming: known.gaming, callbackAt: known.callbackAt, reason: known.reason }
        : null,
  });

  // The scorer found it was not a conversation after all (classification couldn't run earlier):
  // record the real outcome, store no score, and hand the candidate back for another try.
  if (score.call_class && score.call_class !== "conversation") {
    const o = outcomeForClass(score.call_class);
    await db
      .from("calls")
      .update({ outcome: o.outcome, score_status: "done", score_error: `not scored: ${score.call_class}`, score_next_at: null })
      .eq("id", row.id);
    await endChainWithoutScore(db, row);
    return { outcome: o.outcome, scored: false, rescheduled: false };
  }

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
    requirement_scores: (score.requirement_scores ?? null) as Json,
    coverage: (score.coverage ?? null) as Json,
    agreement: (score.agreement ?? null) as Json,
    jd_fit: (score.jd_fit ?? null) as Json,
    confidence: score.confidence ?? null,
    needs_review: score.needs_review ?? false,
    call_class: score.call_class ?? "conversation",
    role_profile_version: score.role_profile_version ?? null,
    language_mix: score.language_mix ?? languageMix(row.transcript),
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
  if (score.callback_requested_at && callbackAllowed(score, { outcome, duration_s: row.duration_s })) {
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
  // Deliveries that arrived but whose processing failed are retried here too (review #8).
  n += await reprocessUnprocessedEvents(db).catch(() => 0);
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
