/**
 * Heads-up message (PRD §8 step 4): when a candidate's call is queued, send
 *   "Hi {first_name}, this is {company} about your {role} application. Aditi from our hiring team
 *    will call you shortly for a 10-minute chat. Prefer another time? Pick one: {link}"
 *
 * sendHeadsUp(callId) sends for one call; POST /api/messaging/sweep (x-dispatch-secret, every
 * minute via pg_cron) sends for every eligible queued call that has none yet, so the dispatcher
 * needs no change. Exactly once per call (unique index), service role only.
 *
 * Truthfulness rules: nothing is sent while calling is paused (DISPATCH_ENABLED), outside the
 * job's calling hours, for closed jobs, or once a human has decided on the candidate. Only first
 * attempts that are not already a booked callback get one, and only when the call is due soon.
 */
import { appBaseUrl, dispatchEnabled } from "../calls/config";
import { safeEqual } from "../calls/secret";
import { inCallingHours, type CallingHours } from "../calls/slots";
import { createAdminClient } from "../supabase/admin";
import { signPickToken } from "./crypto";
import { deliver, untypedDb, type AnyDb } from "./store";

const DUE_SOON_MS = 30 * 60_000;
const MAX_AGE_MS = 24 * 3_600_000;
const SWEEP_MAX = 25;

export type HeadsUpResult = { status: "sent" | "logged" | "failed" | "skipped"; reason?: string };

const clean = (s: string, max: number) => s.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
export const firstName = (name: string) => clean(name, 120).split(" ")[0] || "there";

export function headsUpBody(p: { firstName: string; company: string; role: string; link: string }): string {
  return `Hi ${clean(p.firstName, 40)}, this is ${clean(p.company, 60)} about your ${clean(p.role, 80)} application. Aditi from our hiring team will call you shortly for a 10-minute chat. Prefer another time? Pick one: ${p.link}`;
}

export function pickTimeUrl(callId: string, now: Date = new Date()): string | null {
  const base = appBaseUrl();
  if (!base) return null;
  return `${base}/pick-time/${signPickToken(callId, now)}`;
}

export async function sendHeadsUp(callId: string, opts: { db?: AnyDb; now?: Date } = {}): Promise<HeadsUpResult> {
  const db = opts.db ?? untypedDb(createAdminClient());
  const now = opts.now ?? new Date();
  if (!dispatchEnabled()) return { status: "skipped", reason: "calling_paused" };

  const { data: call } = await db
    .from("calls")
    .select("id, company_id, job_id, candidate_id, state, call_kind, attempt, scheduled, due_at, created_at")
    .eq("id", callId)
    .maybeSingle();
  if (!call) return { status: "skipped", reason: "not_found" };
  if (call.state !== "queued" || call.call_kind !== "phone") return { status: "skipped", reason: "not_queued" };
  if (call.attempt !== 1 || call.scheduled) return { status: "skipped", reason: "not_first_attempt" };
  if (now.getTime() - Date.parse(call.created_at) > MAX_AGE_MS) return { status: "skipped", reason: "too_old" };
  if (Date.parse(call.due_at) - now.getTime() > DUE_SOON_MS) return { status: "skipped", reason: "not_due_soon" };

  const [{ data: job }, { data: candidate }, { data: company }] = await Promise.all([
    db.from("jobs").select("title, status, calling_hours").eq("id", call.job_id).eq("company_id", call.company_id).maybeSingle(),
    db.from("candidates").select("name, phone, status").eq("id", call.candidate_id).eq("company_id", call.company_id).maybeSingle(),
    db.from("companies").select("name").eq("id", call.company_id).maybeSingle(),
  ]);
  if (!job || !candidate || !company) return { status: "skipped", reason: "context_missing" };
  if (job.status !== "open") return { status: "skipped", reason: "job_closed" };
  if (candidate.status === "shortlisted" || candidate.status === "rejected") return { status: "skipped", reason: "decided" };
  if (!inCallingHours((job.calling_hours ?? {}) as CallingHours, now)) return { status: "skipped", reason: "outside_hours" };

  const link = pickTimeUrl(call.id, now);
  if (!link) return { status: "skipped", reason: "no_app_url" };

  const res = await deliver(db, {
    companyId: call.company_id,
    candidateId: call.candidate_id,
    callId: call.id,
    kind: "heads_up",
    to: candidate.phone,
    body: headsUpBody({ firstName: firstName(candidate.name), company: company.name, role: job.title, link }),
  });
  if (res.status === "duplicate") return { status: "skipped", reason: "already_sent" };
  if (res.status === "error") return { status: "failed", reason: "store_failed" };
  return { status: res.status };
}

export type SweepResult = { checked: number; sent: number; logged: number; failed: number; skipped: number; paused?: boolean };

export async function runSweep(opts: { db?: AnyDb; now?: Date; jobId?: string } = {}): Promise<SweepResult> {
  const db = opts.db ?? untypedDb(createAdminClient());
  const now = opts.now ?? new Date();
  const out: SweepResult = { checked: 0, sent: 0, logged: 0, failed: 0, skipped: 0 };
  if (!dispatchEnabled()) return { ...out, paused: true };

  let q = db
    .from("calls")
    .select("id")
    .eq("state", "queued")
    .eq("call_kind", "phone")
    .eq("attempt", 1)
    .eq("scheduled", false)
    .gte("created_at", new Date(now.getTime() - MAX_AGE_MS).toISOString())
    .lte("due_at", new Date(now.getTime() + DUE_SOON_MS).toISOString())
    .order("due_at", { ascending: true })
    .limit(200);
  if (opts.jobId) q = q.eq("job_id", opts.jobId);
  const { data: calls, error } = await q;
  if (error) throw new Error("sweep query failed");
  const ids = (calls ?? []).map((c) => c.id as string);
  if (!ids.length) return out;

  const { data: done } = await db.from("messages").select("call_id").eq("kind", "heads_up").in("call_id", ids);
  const have = new Set((done ?? []).map((m) => m.call_id as string));
  const todo = ids.filter((id) => !have.has(id)).slice(0, SWEEP_MAX);

  for (const id of todo) {
    out.checked++;
    const r = await sendHeadsUp(id, { db, now }).catch(() => ({ status: "failed" as const }));
    out[r.status]++;
  }
  return out;
}

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

/** POST /api/messaging/sweep — machine route, same secret as the dispatcher. */
export async function handleSweep(req: Request): Promise<Response> {
  if (!safeEqual(req.headers.get("x-dispatch-secret"), process.env.DISPATCH_SECRET)) return json({ error: "Unauthorized" }, 401);
  try {
    return json(await runSweep());
  } catch {
    console.error("messaging sweep failed");
    return json({ error: "Sweep failed" }, 500);
  }
}
