/**
 * POST /api/bolna/reschedule — Bolna custom function `reschedule_call` (bolna/app-agent.md §5).
 * Auth: x-bolna-secret (constant time) + best-effort Bolna source IP; bad secret → 401.
 * Everything else answers 200 with a speakable body, so Aditi can say the truthful fallback.
 */
import { createAdminClient } from "../supabase/admin";
import { MAX_RESCHEDULES } from "./config";
import { bolnaIpAllowed, safeEqual } from "./secret";
import { bookCallback, CALL_COLS, type DB } from "./lifecycle";
import { isValidSlot, pickSlots, SLOT_HORIZON_DAYS, slotIso, slotLabel, slotSpoken, SLOT_STEP_MIN, type CallingHours } from "./slots";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A call can book a callback while live or shortly after it ended. */
const BOOKABLE_FOR_MS = 6 * 3_600_000;

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const noBook = (reason: string) => json({ booked: false, reason });
const EMPTY_LIST = { slots: [] as string[], slot_isos: [] as string[] };

export async function handleReschedule(req: Request, now: Date = new Date()): Promise<Response> {
  if (!safeEqual(req.headers.get("x-bolna-secret"), process.env.BOLNA_WEBHOOK_SECRET)) return json({ error: "Unauthorized" }, 401);
  if (!bolnaIpAllowed(req)) return json({ error: "Forbidden" }, 403);

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const action = String(body?.action ?? "").trim().toLowerCase();
  const callId = String(body?.call_id ?? "").trim();
  const slotRaw = String(body?.slot_iso ?? "").trim();
  if (action !== "list" && action !== "book") return noBook("unknown action");

  const db = createAdminClient();
  const ctx = UUID.test(callId) ? await loadBookable(db, callId, now) : null;

  if (action === "list") {
    if (!ctx || ctx.call.reschedule_count >= MAX_RESCHEDULES || ctx.call.callback_at) return json(EMPTY_LIST);
    const slots = await openSlots(db, ctx, now);
    return json({ slots: slots.map((d) => slotLabel(d, now)), slot_isos: slots.map(slotIso) });
  }

  if (!ctx) return noBook("call not found");
  const slot = new Date(slotRaw);
  if (!slotRaw || Number.isNaN(slot.getTime())) return noBook("no valid time given");
  if (ctx.call.callback_at) {
    // Idempotent: the model may repeat a successful booking.
    if (new Date(ctx.call.callback_at).getTime() === slot.getTime()) return json({ booked: true, spoken: slotSpoken(slot, now) });
    return noBook("a callback is already booked for this call");
  }
  if (ctx.call.reschedule_count >= MAX_RESCHEDULES) return noBook("reschedule limit reached");
  if (!isValidSlot(ctx.hours, now, slot)) return noBook("that time is not one of the offered slots");
  if (!(await hasCapacity(db, ctx, slot))) return noBook("slot no longer available");

  const res = await bookCallback(db, ctx.call, slot.toISOString());
  if (!res.ok) return noBook(res.reason);
  return json({ booked: true, spoken: slotSpoken(slot, now) });
}

type Bookable = {
  call: { id: string; candidate_id: string; job_id: string; company_id: string; batch_id: string | null; reschedule_count: number; callback_at: string | null };
  hours: CallingHours;
  limit: number;
};

async function loadBookable(db: DB, callId: string, now: Date): Promise<Bookable | null> {
  const { data: call } = await db.from("calls").select(CALL_COLS).eq("id", callId).maybeSingle();
  if (!call || call.state === "queued") return null;
  if (now.getTime() - Date.parse(call.created_at) > BOOKABLE_FOR_MS) return null;
  const { data: job } = await db
    .from("jobs")
    .select("calling_hours, concurrency_limit")
    .eq("id", call.job_id)
    .eq("company_id", call.company_id)
    .maybeSingle();
  if (!job) return null;
  return { call, hours: (job.calling_hours ?? {}) as CallingHours, limit: Math.max(1, job.concurrency_limit) };
}

/** Queued calls per slot window for this job (a slot is full at the job's concurrency limit). */
async function queuedTimes(db: DB, ctx: Bookable, from: Date, to: Date): Promise<number[]> {
  const { data } = await db
    .from("calls")
    .select("due_at")
    .eq("job_id", ctx.call.job_id)
    .eq("state", "queued")
    .gte("due_at", from.toISOString())
    .lt("due_at", to.toISOString())
    .limit(5000);
  return (data ?? []).map((r) => Date.parse(r.due_at));
}

const windowCount = (times: number[], slot: Date) => {
  const s = slot.getTime();
  return times.filter((t) => t >= s && t < s + SLOT_STEP_MIN * 60_000).length;
};

async function openSlots(db: DB, ctx: Bookable, now: Date): Promise<Date[]> {
  const times = await queuedTimes(db, ctx, now, new Date(now.getTime() + (SLOT_HORIZON_DAYS + 1) * 86_400_000));
  return pickSlots(ctx.hours, now, (d) => windowCount(times, d) < ctx.limit);
}

async function hasCapacity(db: DB, ctx: Bookable, slot: Date): Promise<boolean> {
  const times = await queuedTimes(db, ctx, slot, new Date(slot.getTime() + SLOT_STEP_MIN * 60_000));
  return windowCount(times, slot) < ctx.limit;
}
