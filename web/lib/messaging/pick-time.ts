/**
 * Public time-pick page logic (/pick-time/[token], POST /api/pick-time). No session: the signed,
 * expiring token IS the authorization, and it only ever grants "move this one queued call".
 * Nothing about the candidate beyond their first name, the company and the role is shown.
 *
 * Slots come from lib/calls/slots (calling hours, IST, 1 h windows, 3 h apart, 7 days ahead);
 * a slot has capacity while the job's queued calls in that window are below its line count.
 * Booking moves the queued call's due_at (max 2 reschedules per call chain, as for callbacks).
 */
import { MAX_RESCHEDULES } from "../calls/config";
import { isValidSlot, pickSlots, SLOT_HORIZON_DAYS, slotIso, slotLabel, slotSpoken, SLOT_STEP_MIN, type CallingHours } from "../calls/slots";
import { createAdminClient } from "../supabase/admin";
import { verifyPickToken } from "./crypto";
import { LIMITS, overLimit } from "./rate-limit";
import { untypedDb, type AnyDb } from "./store";

export const PICK_SLOT_COUNT = 6;

type Ctx = {
  call: { id: string; job_id: string; company_id: string; candidate_id: string; state: string; call_kind: string; due_at: string; reschedule_count: number };
  job: { title: string; status: string; calling_hours: CallingHours | null; concurrency_limit: number };
  company: string;
  firstName: string;
  candidateStatus: string;
};

export type Slot = { iso: string; label: string };
export type PickView =
  | { kind: "invalid" | "expired" | "rate_limited" }
  | { kind: "closed"; company: string; role: string; firstName: string }
  | { kind: "limit"; company: string; role: string; firstName: string; current: string }
  | { kind: "open"; company: string; role: string; firstName: string; current: string; slots: Slot[]; changesLeft: number };

async function loadCtx(db: AnyDb, callId: string): Promise<Ctx | null> {
  const { data: call } = await db
    .from("calls")
    .select("id, job_id, company_id, candidate_id, state, call_kind, due_at, reschedule_count")
    .eq("id", callId)
    .maybeSingle();
  if (!call) return null;
  const [{ data: job }, { data: cand }, { data: company }] = await Promise.all([
    db.from("jobs").select("title, status, calling_hours, concurrency_limit").eq("id", call.job_id).eq("company_id", call.company_id).maybeSingle(),
    db.from("candidates").select("name, status").eq("id", call.candidate_id).eq("company_id", call.company_id).maybeSingle(),
    db.from("companies").select("name").eq("id", call.company_id).maybeSingle(),
  ]);
  if (!job || !cand || !company) return null;
  return {
    call,
    job,
    company: company.name,
    firstName: String(cand.name ?? "").trim().split(/\s+/)[0] || "there",
    candidateStatus: cand.status,
  };
}

const bookable = (c: Ctx) =>
  c.call.state === "queued" && c.call.call_kind === "phone" && c.job.status === "open" && c.candidateStatus !== "shortlisted" && c.candidateStatus !== "rejected";

/** due_at of the job's queued calls in [from, to), excluding this call. */
async function queuedTimes(db: AnyDb, c: Ctx, from: Date, to: Date): Promise<number[]> {
  const { data } = await db
    .from("calls")
    .select("id, due_at")
    .eq("job_id", c.call.job_id)
    .eq("state", "queued")
    .gte("due_at", from.toISOString())
    .lt("due_at", to.toISOString())
    .limit(5000);
  return (data ?? []).filter((r) => r.id !== c.call.id).map((r) => Date.parse(r.due_at));
}

const windowCount = (times: number[], slot: Date) => {
  const s = slot.getTime();
  return times.filter((t) => t >= s && t < s + SLOT_STEP_MIN * 60_000).length;
};
const limitOf = (c: Ctx) => Math.max(1, c.job.concurrency_limit || 1);

export async function openSlots(db: AnyDb, c: Ctx, now: Date): Promise<Date[]> {
  const times = await queuedTimes(db, c, now, new Date(now.getTime() + (SLOT_HORIZON_DAYS + 1) * 86_400_000));
  const hours = (c.job.calling_hours ?? {}) as CallingHours;
  return pickSlots(hours, now, (d) => windowCount(times, d) < limitOf(c), PICK_SLOT_COUNT);
}

function currentLabel(c: Ctx, now: Date) {
  const due = new Date(c.call.due_at);
  return due.getTime() <= now.getTime() + 15 * 60_000 ? "shortly" : slotSpoken(due, now);
}

export async function loadPickView(token: string, ipKey: string, opts: { db?: AnyDb; now?: Date } = {}): Promise<PickView> {
  const db = opts.db ?? untypedDb(createAdminClient());
  const now = opts.now ?? new Date();
  if (await overLimit(db, LIMITS.pickViewIp, ipKey)) return { kind: "rate_limited" };
  const t = verifyPickToken(token, now);
  if (!t.ok) return { kind: t.reason };
  const c = await loadCtx(db, t.value.callId);
  if (!c) return { kind: "invalid" };
  const base = { company: c.company, role: c.job.title, firstName: c.firstName };
  if (!bookable(c)) return { kind: "closed", ...base };
  const current = currentLabel(c, now);
  if (c.call.reschedule_count >= MAX_RESCHEDULES) return { kind: "limit", ...base, current };
  const slots = (await openSlots(db, c, now)).map((d) => ({ iso: slotIso(d), label: slotLabel(d, now) }));
  return { kind: "open", ...base, current, slots, changesLeft: MAX_RESCHEDULES - c.call.reschedule_count };
}

export type BookResult =
  | { ok: true; spoken: string; changesLeft: number }
  | { ok: false; status: number; error: string };

export async function bookPickTime(token: unknown, slotRaw: unknown, ipKey: string, opts: { db?: AnyDb; now?: Date } = {}): Promise<BookResult> {
  const db = opts.db ?? untypedDb(createAdminClient());
  const now = opts.now ?? new Date();
  if (await overLimit(db, LIMITS.pickBookIp, ipKey)) return { ok: false, status: 429, error: "Too many tries. Wait a few minutes and try again." };
  const t = verifyPickToken(token, now);
  if (!t.ok) return { ok: false, status: t.reason === "expired" ? 410 : 404, error: t.reason === "expired" ? "This link has expired." : "This link is not valid." };
  if (await overLimit(db, LIMITS.pickBookToken, t.value.callId)) return { ok: false, status: 429, error: "Too many tries. Wait a few minutes and try again." };

  const c = await loadCtx(db, t.value.callId);
  if (!c) return { ok: false, status: 404, error: "This link is not valid." };
  if (!bookable(c)) return { ok: false, status: 409, error: "This call can no longer be moved." };
  if (c.call.reschedule_count >= MAX_RESCHEDULES) return { ok: false, status: 409, error: "This call has already been moved twice, so it can't be moved again." };

  const slot = new Date(String(slotRaw ?? ""));
  if (typeof slotRaw !== "string" || Number.isNaN(slot.getTime())) return { ok: false, status: 400, error: "Pick one of the times shown." };
  const hours = (c.job.calling_hours ?? {}) as CallingHours;
  if (!isValidSlot(hours, now, slot)) return { ok: false, status: 400, error: "That time is not available. Pick one of the times shown." };
  const times = await queuedTimes(db, c, slot, new Date(slot.getTime() + SLOT_STEP_MIN * 60_000));
  if (windowCount(times, slot) >= limitOf(c)) return { ok: false, status: 409, error: "That time just filled up. Pick another one." };

  // Compare-and-set: only this exact queued row at this reschedule count moves.
  const { data: moved } = await db
    .from("calls")
    .update({ due_at: slot.toISOString(), reschedule_count: c.call.reschedule_count + 1, scheduled: true })
    .eq("id", c.call.id)
    .eq("state", "queued")
    .eq("reschedule_count", c.call.reschedule_count)
    .lt("reschedule_count", MAX_RESCHEDULES)
    .select("id")
    .maybeSingle();
  if (!moved) return { ok: false, status: 409, error: "This call just changed. Reload the page and try again." };
  return { ok: true, spoken: slotSpoken(slot, now), changesLeft: MAX_RESCHEDULES - c.call.reschedule_count - 1 };
}
