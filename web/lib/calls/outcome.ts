/** Bolna execution payload → our call state / outcome. Pure (no I/O), unit-tested. */
import type { Database } from "../database.types";

export type CallState = Database["public"]["Enums"]["call_state"];
export type CallOutcome = Database["public"]["Enums"]["call_outcome"];

export const TERMINAL_STATUSES = new Set([
  "completed",
  "no-answer",
  "busy",
  "failed",
  "canceled",
  "stopped",
  "error",
  "balance-low",
]);

/** Live state for a non-terminal status, or null if the status says nothing about the call. */
export function liveState(status: string): CallState | null {
  switch (status) {
    case "scheduled":
    case "queued":
    case "initiated":
    case "ringing":
      return "dialing";
    case "in-progress":
    case "call-disconnected":
      return "in_call";
    default:
      return null;
  }
}

export type ExecutionFacts = {
  status: string;
  terminationReason: string | null;
  conversationSeconds: number;
  transcript: string;
};

/** A conversation happened: Bolna billed talk time and the candidate said something. */
export function hadConversation(f: Pick<ExecutionFacts, "conversationSeconds" | "transcript">): boolean {
  return f.conversationSeconds > 0 && /^\s*user\s*:/im.test(f.transcript);
}

const RETRY_ERRORS = new Set([
  "agent_llm_error",
  "agent_transcription_error",
  "agent_voice_error",
  "agent_realtime_error",
  "agent_network_error",
  "network_error",
]);
const ACCOUNT_ERRORS = new Set([
  "insufficient_balance",
  "provider_account_balance",
  "account_suspended",
  "rate_limited",
  "concurrency_limit_reached",
  "provider_error",
  "platform_error",
]);

export type Classified = {
  outcome: CallOutcome;
  /** Requeue another attempt (+30 min) if attempts remain. */
  retry: boolean;
  /** Run scoring on the transcript. */
  score: boolean;
};

/** Terminal execution → outcome (bolna/app-agent.md §4 table). Scoring may refine completed → short_exit / rescheduled. */
export function classifyTerminal(f: ExecutionFacts): Classified {
  const reason = (f.terminationReason ?? "").toLowerCase();
  const talked = hadConversation(f);

  switch (reason) {
    case "voicemail_reached":
      return { outcome: "voicemail", retry: true, score: false };
    case "no_answer":
    case "dial_timeout":
    case "abandoned":
    case "number_unreachable":
      return { outcome: "no_answer", retry: true, score: false };
    case "busy":
      return { outcome: "busy", retry: true, score: false };
    case "declined":
      return { outcome: talked ? "declined" : "no_answer", retry: !talked, score: talked };
    case "invalid_number":
    case "number_blocked":
    case "caller_id_rejected":
    case "canceled_via_api":
      return { outcome: "failed", retry: false, score: false };
  }
  if (RETRY_ERRORS.has(reason)) return talked ? { outcome: "dropped", retry: true, score: true } : { outcome: "failed", retry: true, score: false };
  if (ACCOUNT_ERRORS.has(reason)) return { outcome: "failed", retry: true, score: false };

  switch (f.status) {
    case "no-answer":
      return { outcome: "no_answer", retry: true, score: false };
    case "busy":
      return { outcome: "busy", retry: true, score: false };
    case "failed":
    case "error":
    case "balance-low":
      return { outcome: "failed", retry: true, score: false };
    case "canceled":
    case "stopped":
      return { outcome: "failed", retry: false, score: false };
  }

  // completed (agent_ended_call, user_hung_up, max_duration_reached, inactivity_timeout, unknown, ...)
  if (talked) return { outcome: "completed", retry: false, score: true };
  if (f.conversationSeconds <= 0 && !f.transcript.trim()) return { outcome: "no_answer", retry: true, score: false };
  return { outcome: "dropped", retry: false, score: false };
}

/** Fields we read from a Bolna execution object (same shape as GET /executions/{id}). */
export type BolnaExecution = {
  id?: string;
  agent_id?: string;
  status?: string;
  termination_reason?: string | null;
  error_message?: string | null;
  conversation_duration?: number | string | null;
  total_cost?: number | string | null;
  transcript?: string | null;
  created_at?: string | null;
  initiated_at?: string | null;
  telephony_data?: { duration?: number | string | null; recording_url?: string | null } | null;
  context_details?: { recipient_data?: Record<string, unknown> | null } | null;
};

const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : 0;
};

export function factsOf(e: BolnaExecution): ExecutionFacts & {
  recordingUrl: string | null;
  costCents: number | null;
  durationSeconds: number;
} {
  const cost = e.total_cost;
  return {
    status: String(e.status ?? ""),
    terminationReason: e.termination_reason ? String(e.termination_reason) : null,
    conversationSeconds: num(e.conversation_duration),
    transcript: typeof e.transcript === "string" ? e.transcript : "",
    recordingUrl: e.telephony_data?.recording_url ? String(e.telephony_data.recording_url) : null,
    costCents: cost === null || cost === undefined || cost === "" ? null : num(cost),
    durationSeconds: Math.round(num(e.conversation_duration) || num(e.telephony_data?.duration)),
  };
}
