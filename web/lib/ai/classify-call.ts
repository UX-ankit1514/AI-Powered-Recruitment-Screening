/**
 * Deterministic first look at a transcript: is this obviously NOT a conversation with the candidate
 * (voicemail, someone else, silence)? Pure; unit-tested. The model pass (evaluate.ts) decides the
 * unclear cases; these rules only short-circuit the obvious ones so no tokens are spent on them.
 */
import { candidateText } from "./text";

export const CALL_CLASSES = ["conversation", "voicemail", "wrong_person", "no_speech", "dropped"] as const;
export type CallClass = (typeof CALL_CLASSES)[number];

export type Heuristic = { cls: CallClass; confident: boolean; reason: string; candidateWords: number; candidateTurns: number };

const VOICEMAIL =
  /(leave (a|your) (message|name)|after the (tone|beep)|is not available|isn'?t available|voice ?mail|mailbox|record your message|the (number|subscriber) you (have )?(dialled|dialed|are (trying to )?(call|reach)ing)|switched off|not reachable|out of (coverage|service) area|please try (again )?later|press \d|aap(ne)? jis number|abhi vyast|uplabdh nahi|पहुंच से बाहर|व्यस्त है|उपलब्ध नहीं|स्विच ऑफ)/i;
const WRONG_PERSON =
  /(wrong number|galat number|no one (by|named|called) that|nobody (by|named|called) that|(he|she)('s| is) not (here|home|available|around)|(he|she) (has )?(gone|went) out|this is (his|her) (brother|sister|mother|father|wife|husband|son|daughter|friend|colleague)|i am (his|her) (brother|sister|mother|father|wife|husband|son|daughter|friend|colleague)|(main|mai) (unka|unki|uska|uski) (bhai|behen|mummy|papa|wife|husband|beta|beti)|woh (ghar pe|abhi) nahi|you have the wrong)/i;

function turns(transcript: string): { candidate: number; agent: number } {
  let candidate = 0;
  let agent = 0;
  for (const line of String(transcript ?? "").split(/\r?\n/)) {
    if (/^\s*(user|candidate|human|customer)\s*:/i.test(line)) candidate++;
    else if (/^\s*(assistant|agent|aditi|bot|ai)\s*:/i.test(line)) agent++;
  }
  return { candidate, agent };
}

export function heuristicClass(transcript: string): Heuristic {
  const t = String(transcript ?? "");
  const cand = candidateText(t);
  const words = (cand.match(/[\p{L}\p{N}]+/gu) ?? []).length;
  const { candidate: candTurns } = turns(t);
  const hasLabels = /^\s*(user|assistant)\s*:/im.test(t);
  const base = { candidateWords: words, candidateTurns: candTurns };

  if (!t.trim() || (hasLabels && candTurns === 0) || words < 3) {
    return { ...base, cls: "no_speech", confident: true, reason: "The candidate said nothing meaningful." };
  }
  if (VOICEMAIL.test(cand) && words < 80 && candTurns <= 4) {
    return { ...base, cls: "voicemail", confident: true, reason: "The call reached a voicemail or operator message." };
  }
  if (WRONG_PERSON.test(cand) && candTurns <= 6 && words < 120) {
    return { ...base, cls: "wrong_person", confident: true, reason: "Someone other than the candidate answered." };
  }
  if (words < 12 && candTurns <= 2) {
    return { ...base, cls: "no_speech", confident: false, reason: "Very little speech from the candidate." };
  }
  // Long, multi-turn exchange: certainly a conversation (the model still supplies call facts).
  const confident = candTurns >= 6 && words >= 80;
  return { ...base, cls: "conversation", confident, reason: confident ? "A real back-and-forth with the candidate." : "Short exchange; needs a closer look." };
}

/** Outcome stored on the call for a non-conversation, and whether to dial again (phone calls only). */
export function outcomeForClass(cls: CallClass): { outcome: "voicemail" | "wrong_person" | "no_answer" | "dropped" | "completed"; retry: boolean } {
  switch (cls) {
    case "voicemail":
      return { outcome: "voicemail", retry: true };
    case "wrong_person":
      // Usually a family member picked up; try again later (attempt cap still applies).
      return { outcome: "wrong_person", retry: true };
    case "no_speech":
      return { outcome: "no_answer", retry: true };
    case "dropped":
      return { outcome: "dropped", retry: true };
    default:
      return { outcome: "completed", retry: false };
  }
}
