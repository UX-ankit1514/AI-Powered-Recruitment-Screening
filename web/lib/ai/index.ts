/** AI services (server only). Pure maths lives in ./scoring-math (safe for client components). */
import "server-only";

export { readResume } from "./read-resume";
export { draftRubric } from "./draft-rubric";
export { writeCallBrief, type BriefProfile, type BriefJob, type BriefCompany, type BriefOptions } from "./call-brief";
export { scoreCall, type ScoreCallInput } from "./score-call";
export { verifyQuotes } from "./verify-quotes";
export { anonymise } from "./anonymise";
export { computeOverall, pickFor, hasFailedMustHave, PRESET_QUALITY_KEYS, CUTOFFS, PICK_LABELS, type PickValue } from "./scoring-math";
export { callJson, chat, extractJson, AiError, DEFAULT_MODEL } from "./client";
export * from "./schemas";
export { RESUME_PROMPT_VERSION } from "./prompts/resume";
export { RUBRIC_PROMPT_VERSION } from "./prompts/rubric";
export { BRIEF_PROMPT_VERSION } from "./prompts/brief";
export { SCORE_PROMPT_VERSION } from "./prompts/score";
