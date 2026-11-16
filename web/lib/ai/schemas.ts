/**
 * Zod schemas for every AI output. "Raw" schemas are lenient about cosmetic drift in model replies
 * (string numbers, quotes as strings, missing optional fields); public result schemas are strict and are
 * what callers store. Pure; safe anywhere.
 */
import { z } from "zod";

// ---------- lenient field helpers ----------
const strOrNull = z.preprocess(
  (v) => (typeof v === "string" && v.trim() && !/^(null|n\/a|none|unknown)$/i.test(v.trim()) ? v.trim() : null),
  z.string().nullable(),
);
const str = z.preprocess((v) => (typeof v === "string" ? v.trim() : v == null ? "" : String(v)), z.string());
const bool = z.preprocess((v) => v === true || v === "true" || v === "yes", z.boolean());
const strList = (max: number) =>
  z.preprocess(
    (v) => (Array.isArray(v) ? v : typeof v === "string" && v.trim() ? [v] : []),
    z.array(z.unknown()).transform((a) =>
      a
        .map((x) => (typeof x === "string" ? x.trim() : x && typeof x === "object" && "text" in x ? String((x as { text: unknown }).text ?? "").trim() : ""))
        .filter(Boolean)
        .slice(0, max),
    ),
  );
const numOrNull = z.preprocess((v) => {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[^\d.\-]/g, ""));
  return Number.isFinite(n) ? n : null;
}, z.number().nullable());
const score1to5 = z.preprocess((v) => {
  if (v == null || v === "") return null;
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 1 && n <= 5 ? n : null;
}, z.number().int().min(1).max(5).nullable());

// ---------- readResume ----------
export const ProfileSchema = z.object({
  name: z.string().nullable(),
  current_role: z.string().nullable(),
  years_experience: z.number().min(0).max(60).nullable(),
  skills: z.array(z.string()),
  companies: z.array(z.string()),
  location: z.string().nullable(),
  notice_period_days: z.number().int().min(0).max(365).nullable(),
  languages: z.array(z.string()),
  education: z.string().nullable(),
});
export type Profile = z.infer<typeof ProfileSchema>;

export const RawResumeSchema = z.object({
  profile: z
    .object({
      name: strOrNull.optional().default(null),
      current_role: strOrNull.optional().default(null),
      years_experience: numOrNull.optional().default(null),
      skills: strList(25).optional().default([]),
      companies: strList(15).optional().default([]),
      location: strOrNull.optional().default(null),
      notice_period_days: numOrNull.optional().default(null),
      languages: strList(10).optional().default([]),
      education: strOrNull.optional().default(null),
    })
    .passthrough(),
  resume_only_score: numOrNull,
  resume_note: str,
  resume_questions: strList(2).refine((a) => a.length === 2, "exactly 2 resume_questions required"),
});

export const ReadResumeResultSchema = z.object({
  profile: ProfileSchema,
  resume_only_score: z.number().int().min(0).max(100).nullable(),
  resume_note: z.string().max(400),
  resume_questions: z.array(z.string().min(1)).length(2),
  model_version: z.string(),
  prompt_version: z.string(),
});
export type ReadResumeResult = z.infer<typeof ReadResumeResultSchema>;

// ---------- draftRubric ----------
export const SuggestedTraitSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]*$/),
  name: z.string().min(1),
  description: z.string(),
});
export const RawRubricSchema = z.object({
  must_haves: strList(6),
  nice_to_haves: strList(8),
  suggested_traits: z
    .array(z.object({ key: str.optional(), name: str, description: str.optional().default("") }))
    .catch([]),
});
export const DraftRubricResultSchema = z.object({
  must_haves: z.array(z.string().min(1)).max(6),
  nice_to_haves: z.array(z.string().min(1)).max(8),
  suggested_traits: z.array(SuggestedTraitSchema).max(4),
  model_version: z.string(),
  prompt_version: z.string(),
});
export type DraftRubricResult = z.infer<typeof DraftRubricResultSchema>;

// ---------- writeCallBrief ----------
export const RawBriefSchema = z.object({
  jd_summary: str.refine((s) => s.length > 0, "jd_summary required"),
  resume_q1: str.refine((s) => s.length > 0, "resume_q1 required"),
  resume_q2: str.refine((s) => s.length > 0, "resume_q2 required"),
});
/** Bolna `user_data` (all strings; keys fill {{key}} in Aditi's prompt). */
export const CallBriefSchema = z.object({
  call_id: z.string().optional(),
  first_name: z.string().min(1),
  role: z.string().min(1),
  company: z.string().min(1),
  resume_note: z.string(),
  resume_q1: z.string().min(1),
  resume_q2: z.string().min(1),
  must_haves: z.string(),
  jd_summary: z.string(),
  faq: z.string(),
  culture_values: z.string(),
  traits: z.string(),
  other_interest_prompt: z.string(),
  /** eval-v1: compressed ordered question plan and the company's other open roles. */
  interview_plan: z.string().default(""),
  open_roles: z.string().default(""),
});
export type CallBrief = z.infer<typeof CallBriefSchema>;

// ---------- scoreCall ----------
export const QuoteSchema = z.object({ text: z.string().min(1), ts: z.union([z.number(), z.string()]).nullable() });
export const QualityResultSchema = z.object({
  /** 1–5; may be fractional (mean of two scoring passes, folded with mapped requirements). */
  score: z.number().min(1).max(5).nullable(),
  reason: z.string(),
  quotes: z.array(QuoteSchema),
});
export const MustHaveResultSchema = z.object({
  text: z.string(),
  met: z.union([z.boolean(), z.literal("unknown")]),
  quote: z.string().nullable(),
  /** eval-v1: the must-have check id and adjudication (met | not_met | unclear). */
  id: z.string().optional(),
  status: z.enum(["met", "not_met", "unclear"]).optional(),
});
export const FlagsSchema = z.object({
  other_role: z.object({ job_id: z.string().nullable(), title: z.string(), reason: z.string() }).nullable(),
  culture_standout: z.boolean(),
  wants_internship: z.boolean(),
  resume_mismatch: z.array(z.object({ claim_quote: z.string(), resume_line: z.string() })),
  hr_review: z.string().nullable(),
});
export const ScoreCallResultSchema = z.object({
  qualities: z.record(z.string(), QualityResultSchema),
  must_have_results: z.array(MustHaveResultSchema),
  flags: FlagsSchema,
  summary: z.string(),
  profile_updates: z.record(z.string(), z.unknown()).nullable(),
  short_exit: z.boolean(),
  conduct_ended: z.boolean(),
  callback_requested_at: z.iso.datetime({ offset: true }).nullable(),
  model_version: z.string(),
  prompt_version: z.string(),
  // ---- eval-v1 (multi-pass) additions; optional so older results still validate ----
  call_class: z.enum(["conversation", "voicemail", "wrong_person", "no_speech", "dropped"]).optional(),
  call_class_reason: z.string().optional(),
  requirement_scores: z.record(z.string(), z.lazy(() => RequirementScoreSchema)).optional(),
  coverage: z.record(z.string(), z.enum(["asked_answered", "asked_weak", "not_asked"])).optional(),
  agreement: z.lazy(() => AgreementSchema).optional(),
  jd_fit: z.lazy(() => JdFitSchema).optional(),
  confidence: z.number().min(0).max(1).optional(),
  needs_review: z.boolean().optional(),
  language_mix: z.enum(["english", "hinglish", "other"]).nullable().optional(),
  role_profile_version: z.number().int().optional(),
});
export const RequirementScoreSchema = z.object({
  text: z.string(),
  importance: z.enum(["must", "core", "nice"]),
  quality: z.string(),
  score: z.number().min(1).max(5).nullable(),
  pass_scores: z.tuple([z.number().nullable(), z.number().nullable()]),
  justification: z.string(),
  quotes: z.array(QuoteSchema),
  status: z.enum(["met", "partial", "not_met", "not_covered"]),
});
export const AgreementSchema = z.object({
  passes: z.number().int(),
  max_diff: z.number(),
  agreement_rate: z.number().min(0).max(1),
  disagreements: z.array(z.object({ id: z.string(), a: z.number().nullable(), b: z.number().nullable(), note: z.string() })),
});
export const JdFitSchema = z.object({
  fit_pct: z.number().nullable(),
  requirements: z.array(
    z.object({
      id: z.string(),
      text: z.string(),
      importance: z.enum(["must", "core", "nice"]),
      status: z.enum(["met", "partial", "not_met", "not_covered"]),
      score: z.number().nullable(),
      quote: z.string().nullable(),
      justification: z.string(),
    }),
  ),
  strengths: z.array(z.string()),
  gaps: z.array(z.string()),
  hidden_fits: z.array(z.object({ job_id: z.string().nullable(), title: z.string(), reason: z.string() })),
  rationale: z.string(),
  not_covered: z.array(z.string()),
});
export type RequirementScore = z.infer<typeof RequirementScoreSchema>;
export type Agreement = z.infer<typeof AgreementSchema>;
export type JdFit = z.infer<typeof JdFitSchema>;
export type ScoreCallResult = z.infer<typeof ScoreCallResultSchema>;
export type QualityResult = z.infer<typeof QualityResultSchema>;

const rawQuality = z.object({
  score: score1to5,
  reason: str.optional().default(""),
  quotes: strList(3).optional().default([]),
});
const rawMet = z.preprocess((v) => {
  if (v === true || v === "true" || v === "yes" || v === "met") return true;
  if (v === false || v === "false" || v === "no" || v === "not met") return false;
  return "unknown";
}, z.union([z.boolean(), z.literal("unknown")]));

/** Model-facing scoring schema; requires every expected quality key so a partial reply triggers the retry. */
export function makeRawScoreSchema(qualityKeys: readonly string[]) {
  return z.object({
    qualities: z.record(z.string(), rawQuality).superRefine((q, ctx) => {
      const missing = qualityKeys.filter((k) => !(k in q));
      if (missing.length) ctx.addIssue({ code: "custom", message: `qualities missing keys: ${missing.join(", ")}` });
    }),
    must_have_results: z
      .array(z.object({ text: str, met: rawMet, quote: strOrNull.optional().default(null) }))
      .optional()
      .default([]),
    flags: z
      .object({
        other_role: z
          .preprocess(
            (v) => (typeof v === "string" ? (v.trim() ? { title: v.trim(), reason: "" } : null) : v ?? null),
            z.object({ title: str, reason: str.optional().default("") }).nullable(),
          )
          .optional()
          .default(null),
        culture_standout: bool.optional().default(false),
        wants_internship: bool.optional().default(false),
        resume_mismatch: z
          .array(
            z.preprocess(
              (v) => (typeof v === "string" ? { claim_quote: v, resume_line: "" } : v),
              z.object({ claim_quote: str, resume_line: str.optional().default("") }),
            ),
          )
          .catch([]),
        hr_review: strOrNull.optional().default(null),
      })
      .optional()
      .default({ other_role: null, culture_standout: false, wants_internship: false, resume_mismatch: [], hr_review: null }),
    summary: str,
    profile_updates: z.record(z.string(), z.unknown()).nullable().catch(null).optional().default(null),
    short_exit: bool.optional().default(false),
    conduct_ended: bool.optional().default(false),
    callback_requested_at: strOrNull.optional().default(null),
  });
}

