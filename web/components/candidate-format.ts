/** Pure display helpers shared by dashboard and job screens (no I/O, safe on server and client). */
import { computeOverall, pickFor, hasFailedMustHave, type PickValue } from "@/lib/ai/scoring-math";
import type { CallOutcome, CallState } from "@/lib/types";

export { computeOverall, pickFor, hasFailedMustHave };
export type { PickValue };

export const PICK_LABEL: Record<PickValue, string> = { amazing: "Amazing", good: "Good", maybe: "Maybe", no: "No" };
export const PICK_ORDER: Record<PickValue, number> = { amazing: 0, good: 1, maybe: 2, no: 3 };

const SOURCE_LABEL: Record<string, string> = {
  csv: "Spreadsheet",
  form: "Public form",
  portal_mock: "Job portal",
  naukri: "Naukri",
  linkedin: "LinkedIn",
  web: "Browser call",
  phone: "Phone call",
};
export function sourceLabel(source: string | null | undefined) {
  if (!source) return "Unknown source";
  return SOURCE_LABEL[source] ?? source.replace(/[_-]+/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w.charAt(0).toUpperCase())
    .join("");
}

export function mmss(totalSeconds: number) {
  const s = Math.max(0, Math.round(totalSeconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function formatInt(n: number) {
  return n.toLocaleString("en-IN");
}

export { formatCallCost, formatUsdFromCents, formatInrFromCents } from "@/lib/cost";

/** Tolerant reader for the scores.flags JSON (written by the scorer; shape may grow). */
export type Flags = {
  otherRole: string | null;
  cultureStandout: boolean;
  wantsInternship: boolean;
  resumeMismatch: number;
  hrReview: string | null;
};
export function readFlags(raw: unknown): Flags {
  const f = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const other = f.other_role as Record<string, unknown> | string | null | undefined;
  let otherRole: string | null = null;
  if (typeof other === "string" && other.trim()) otherRole = other;
  else if (other && typeof other === "object") {
    otherRole = String(other.title ?? other.role ?? other.reason ?? "another role");
  }
  return {
    otherRole,
    cultureStandout: f.culture_standout === true,
    wantsInternship: f.wants_internship === true,
    resumeMismatch: Array.isArray(f.resume_mismatch) ? f.resume_mismatch.length : 0,
    hrReview: typeof f.hr_review === "string" && f.hr_review ? f.hr_review : null,
  };
}
export function isHiddenFit(f: Flags) {
  return Boolean(f.otherRole || f.cultureStandout || f.wantsInternship || f.resumeMismatch > 0);
}

const OUTCOME_LABEL: Record<CallOutcome, string> = {
  completed: "Full",
  short_exit: "Short exit",
  no_answer: "No answer",
  busy: "Line busy",
  voicemail: "Voicemail",
  wrong_person: "Wrong person",
  declined: "Declined",
  rescheduled: "Rescheduled",
  dropped: "Dropped",
  failed: "Call failed",
};

export type CallSummary = {
  state: CallState;
  outcome: CallOutcome | null;
  durationS: number | null;
  attempt: number;
};

/** Text for the table's Call column. Duration only when the call actually connected. */
export function callText(call: CallSummary | null): { text: string; duration: string | null } {
  if (!call) return { text: "Not called", duration: null };
  if (call.outcome) {
    const connected = call.outcome === "completed" || call.outcome === "short_exit";
    return {
      text: OUTCOME_LABEL[call.outcome],
      duration: connected && typeof call.durationS === "number" ? mmss(call.durationS) : null,
    };
  }
  if (call.state === "in_call") return { text: "On a call", duration: null };
  if (call.state === "dialing") return { text: "Dialling", duration: null };
  if (call.state === "queued") return { text: call.attempt > 1 ? "Retry queued" : "Queued", duration: null };
  return { text: "Finished", duration: null };
}
