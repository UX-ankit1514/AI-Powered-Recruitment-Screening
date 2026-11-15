/** Callback slot maths in Asia/Kolkata (fixed +05:30, no DST). Pure. */

const IST_MIN = 330;
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export type CallingHours = { start?: string; end?: string; days?: number[] };

export const SLOT_STEP_MIN = 60;
export const SLOT_LEAD_MIN = 60; // first slot at least an hour away
export const SLOT_HORIZON_DAYS = 7;
export const SLOT_SPACING_MIN = 180; // offered slots at least 3 h apart

function hhmm(s: string | undefined, fallback: number): number {
  const m = /^(\d{1,2}):(\d{2})/.exec(s ?? "");
  if (!m) return fallback;
  const v = Number(m[1]) * 60 + Number(m[2]);
  return v >= 0 && v <= 1440 ? v : fallback;
}

function ist(d: Date) {
  const s = new Date(d.getTime() + IST_MIN * 60_000);
  return { dow: s.getUTCDay(), minute: s.getUTCHours() * 60 + s.getUTCMinutes(), dayKey: s.toISOString().slice(0, 10) };
}

export function inCallingHours(hours: CallingHours | null | undefined, d: Date): boolean {
  const h = hours ?? {};
  const days = Array.isArray(h.days) ? h.days : [0, 1, 2, 3, 4, 5, 6];
  const { dow, minute } = ist(d);
  if (!days.includes(dow) && !(dow === 0 && days.includes(7))) return false;
  return minute >= hhmm(h.start, 600) && minute < hhmm(h.end, 1140);
}

/** All on-the-hour candidate slots within calling hours, from now + lead to the horizon. */
export function candidateSlots(hours: CallingHours | null | undefined, now: Date): Date[] {
  const first = new Date(now.getTime() + SLOT_LEAD_MIN * 60_000);
  first.setUTCSeconds(0, 0);
  // align to the IST hour (IST is UTC+5:30, so IST :00 is UTC :30)
  const istMin = (first.getUTCMinutes() + 30) % 60;
  if (istMin !== 0) first.setTime(first.getTime() + (60 - istMin) * 60_000);
  const out: Date[] = [];
  const end = now.getTime() + SLOT_HORIZON_DAYS * 86_400_000;
  for (let t = first.getTime(); t <= end; t += SLOT_STEP_MIN * 60_000) {
    const d = new Date(t);
    if (inCallingHours(hours, d)) out.push(d);
  }
  return out;
}

export function isValidSlot(hours: CallingHours | null | undefined, now: Date, slot: Date): boolean {
  return candidateSlots(hours, now).some((d) => d.getTime() === slot.getTime());
}

/** First `n` slots with spare capacity, spaced apart so the choice is meaningful. */
export function pickSlots(
  hours: CallingHours | null | undefined,
  now: Date,
  hasCapacity: (slot: Date) => boolean,
  n = 3,
): Date[] {
  const out: Date[] = [];
  for (const d of candidateSlots(hours, now)) {
    if (out.length >= n) break;
    const last = out[out.length - 1];
    if (last && d.getTime() - last.getTime() < SLOT_SPACING_MIN * 60_000) continue;
    if (hasCapacity(d)) out.push(d);
  }
  return out;
}

function clock(minute: number): string {
  const h24 = Math.floor(minute / 60);
  const m = minute % 60;
  const h = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h}${m ? `:${String(m).padStart(2, "0")}` : ""} ${h24 < 12 ? "am" : "pm"}`;
}

function dayWord(d: Date, now: Date): "today" | "tomorrow" | null {
  const a = ist(d).dayKey;
  if (a === ist(now).dayKey) return "today";
  if (a === ist(new Date(now.getTime() + 86_400_000)).dayKey) return "tomorrow";
  return null;
}

/** Short label for the list ("Tue 2 pm", "tomorrow 11 am"). */
export function slotLabel(d: Date, now: Date): string {
  const { dow, minute } = ist(d);
  return `${dayWord(d, now) ?? DAY_SHORT[dow]} ${clock(minute)}`;
}

/** Confirmation phrase ("Tuesday at 2 pm", "tomorrow at 11 am"). */
export function slotSpoken(d: Date, now: Date): string {
  const { dow, minute } = ist(d);
  return `${dayWord(d, now) ?? DAY_NAMES[dow]} at ${clock(minute)}`;
}

/** "2026-11-17T08:30:00Z" */
export function slotIso(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}
