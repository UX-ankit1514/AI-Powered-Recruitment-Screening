/**
 * POST /api/dispatch (header x-dispatch-secret). Called every minute by pg_cron and nudged after
 * batch starts / terminal webhooks. Claims due calls (SQL: calling hours, company-wide line cap,
 * skip locked), builds the brief and asks Bolna to dial. A capacity refusal from Bolna (429) puts
 * the call back in the queue for 2 minutes without using one of the candidate's attempts.
 *
 * SAFETY LOCK: Bolna is contacted only if DISPATCH_ENABLED === "true" AND the phone is an Indian
 * mobile (+91 6-9…). Otherwise the call is finished as failed / dispatch_blocked, never dialled.
 */
import { z } from "zod";
import { createAdminClient } from "../supabase/admin";
import { DIALABLE_PHONE, REFUSAL_REQUEUE_MIN, bolnaKey, defaultLines, dispatchEnabled } from "./config";
import { safeEqual } from "./secret";
import { BolnaError, startPhoneCall } from "./bolna";
import { buildUserData, loadCallContext } from "./context";
import { batchStopped, endChainWithoutScore, finishCall, setCandidateStatus, untyped, type DB } from "./lifecycle";
import { reapStaleCalls, retryPendingScores } from "./webhook";
import { flushRetentionFiles } from "../retention/files";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const Body = z.object({ job_id: z.string().regex(UUID).optional() }).catch({});

type Claimed = { call_id: string; job_id: string; company_id: string; candidate_id: string; attempt: number };
export type DispatchResult = { started: number; blocked: number; failed: number; requeued: number; in_flight: number; reaped: number; rescored: number };

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function handleDispatch(req: Request): Promise<Response> {
  if (!safeEqual(req.headers.get("x-dispatch-secret"), process.env.DISPATCH_SECRET)) return json({ error: "Unauthorized" }, 401);
  const raw = await req.json().catch(() => ({}));
  const { job_id } = Body.parse(raw ?? {});
  try {
    const r = await runDispatch({ jobId: job_id });
    return json(r);
  } catch (e) {
    console.error("dispatch failed", e instanceof Error ? e.message : "unknown");
    return json({ error: "Dispatch failed" }, 500);
  }
}

export async function runDispatch(opts: { jobId?: string; limit?: number; db?: DB } = {}): Promise<DispatchResult> {
  const db = opts.db ?? createAdminClient();
  const result: DispatchResult = { started: 0, blocked: 0, failed: 0, requeued: 0, in_flight: 0, reaped: 0, rescored: 0 };
  // The every-minute cron run (no job filter) records a tick, so Settings can tell the scheduler is alive.
  if (!opts.jobId) await recordTick(db);

  if (bolnaKey()) result.reaped = await reapStaleCalls(db, opts.jobId).catch(() => 0);

  const { data, error } = await untyped(db).rpc("claim_due_calls", {
    p_limit: opts.limit ?? 10,
    p_job_id: opts.jobId ?? null,
    p_default_lines: defaultLines(),
  });
  if (error) throw new Error("claim_due_calls failed");
  const claimed = (data ?? []) as Claimed[];

  const outcomes = await Promise.all(claimed.map((c) => dialOne(db, c).catch(() => "failed" as const)));
  for (const o of outcomes) result[o]++;

  // Scoring that failed after a completed call is retried by the every-minute cron run (no job
  // filter), one call per run so the run stays well inside maxDuration. Backoff + max 3 attempts.
  if (!opts.jobId) result.rescored = await retryPendingScores(db, 1).catch(() => 0);
  // Storage files queued by the nightly retention purge are deleted here (server holds the key).
  if (!opts.jobId) await flushRetentionFiles(untyped(db)).catch(() => 0);

  let q = db.from("calls").select("id", { count: "exact", head: true }).in("state", ["dialing", "in_call"]).eq("call_kind", "phone");
  if (opts.jobId) q = q.eq("job_id", opts.jobId);
  const { count } = await q;
  result.in_flight = count ?? 0;
  return result;
}

async function dialOne(db: DB, c: Claimed): Promise<"started" | "blocked" | "failed" | "requeued"> {
  const ctx = await loadCallContext(db, c.candidate_id);
  if (!ctx) {
    const done = await finishCall(db, c.call_id, { outcome: "failed", terminationReason: "context_missing" });
    if (done) await endChainWithoutScore(db, done.row);
    return "failed";
  }

  // ---- SAFETY LOCK: checked before anything is sent anywhere ----
  if (!dispatchEnabled() || !DIALABLE_PHONE.test(ctx.candidate.phone)) {
    const done = await finishCall(db, c.call_id, { outcome: "failed", terminationReason: "dispatch_blocked" });
    if (done) await endChainWithoutScore(db, done.row);
    return "blocked";
  }

  try {
    const userData = await buildUserData(ctx, c.call_id);
    const execId = await startPhoneCall(ctx.candidate.phone, userData);
    await db
      .from("calls")
      .update({ bolna_execution_id: execId, locked_at: new Date().toISOString() })
      .eq("id", c.call_id)
      .eq("state", "dialing");
    await setCandidateStatus(db, c.candidate_id, "calling");
    return "started";
  } catch (e) {
    const status = e instanceof BolnaError ? e.status : 0;
    if (status === 429 && !(await batchStopped(db, (await batchOf(db, c.call_id)) ?? null))) {
      // No free line at Bolna: back in the queue, same attempt, nothing counted against the candidate.
      const { data: back } = await db
        .from("calls")
        .update({ state: "queued", locked_at: null, due_at: new Date(Date.now() + REFUSAL_REQUEUE_MIN * 60_000).toISOString() })
        .eq("id", c.call_id)
        .eq("state", "dialing")
        .is("bolna_execution_id", null)
        .select("id")
        .maybeSingle();
      if (back) return "requeued";
    }
    const retry = status === 0 || status >= 500 || status === 429;
    const done = await finishCall(db, c.call_id, { outcome: "failed", terminationReason: `dispatch_error_${status || "network"}`, retry });
    if (done && !done.retried) await endChainWithoutScore(db, done.row);
    return "failed";
  }
}

/** "The every-minute scheduler ran just now" (read by Settings through scheduler_health()). */
export async function recordTick(db: DB): Promise<void> {
  await untyped(db)
    .from("scheduler_ticks")
    .upsert({ name: "dispatch", at: new Date().toISOString() })
    .then(
      () => undefined,
      () => undefined,
    );
}

async function batchOf(db: DB, callId: string): Promise<string | null> {
  const { data } = await db.from("calls").select("batch_id").eq("id", callId).maybeSingle();
  return data?.batch_id ?? null;
}
