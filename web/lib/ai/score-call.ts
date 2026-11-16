import "server-only";
import { evaluateCall, type EvaluateInput } from "./evaluate";
import type { ScoreCallResult } from "./schemas";

/**
 * Compatible entry point (callers: webhook scoring, live tests). Since eval-v1 this runs the
 * multi-pass evaluation in ./evaluate.ts. The result keeps every legacy field and adds
 * call_class, requirement_scores, coverage, agreement, jd_fit, confidence, needs_review, language_mix.
 * A non-conversation (voicemail, wrong person, no speech, dropped) comes back with call_class set
 * and nothing scored; the caller must not store it as a score.
 */
export type ScoreCallInput = EvaluateInput;

export async function scoreCall(input: ScoreCallInput): Promise<ScoreCallResult> {
  return evaluateCall(input);
}
