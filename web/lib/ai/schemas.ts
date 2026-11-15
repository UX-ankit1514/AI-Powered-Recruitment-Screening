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
});
export type CallBrief = z.infer<typeof CallBriefSchema>;

// ---------- scoreCall ----------
export const QuoteSchema = z.object({ text: z.string().min(1), ts: z.union([z.number(), z.string()]).nullable() });
export const QualityResultSchema = z.object({
  score: z.number().int().min(1).max(5).nullable(),
  reason: z.string(),
  quotes: z.array(QuoteSchema),
});
export const MustHaveResultSchema = z.object({
  text: z.string(),
  met: z.union([z.boolean(), z.literal("unknown")]),
  quote: z.string().nullable(),
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
});
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

