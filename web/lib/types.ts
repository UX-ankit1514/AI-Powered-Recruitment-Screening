/**
 * Shared types (owned by M1; other modules may append, never rename).
 * Row types come from the generated `database.types.ts` (regenerate after schema changes).
 * JSON column shapes are zod schemas so every module validates the same way.
 */
import { z } from "zod";
import type { Database } from "@/lib/database.types";

type Tables = Database["public"]["Tables"];
type Views = Database["public"]["Views"];
type Enums = Database["public"]["Enums"];

export type Company = Tables["companies"]["Row"];
export type Member = Tables["members"]["Row"];
export type Job = Tables["jobs"]["Row"];
export type Rubric = Tables["rubrics"]["Row"];
export type Batch = Tables["batches"]["Row"];
export type Candidate = Tables["candidates"]["Row"];
export type Call = Tables["calls"]["Row"];
export type Score = Tables["scores"]["Row"];
export type Action = Tables["actions"]["Row"];
export type WebhookEvent = Tables["webhook_events"]["Row"];
export type CandidateRanking = Views["candidate_ranking"]["Row"];

export type MemberRole = Enums["member_role"];
export type CallState = Enums["call_state"];
export type CallOutcome = Enums["call_outcome"];
export type Pick = Enums["pick"];
export type ActionType = Enums["action_type"];

export const CANDIDATE_STATUSES = [
  "imported", "ats_filtered", "queued", "calling", "scored", "shortlisted", "rejected",
] as const;
export type CandidateStatus = (typeof CANDIDATE_STATUSES)[number];

export const ATS_MODES = ["call_everyone", "ats_filter"] as const;
export type AtsMode = (typeof ATS_MODES)[number];

export const CALL_KINDS = ["phone", "web"] as const;
export type CallKind = (typeof CALL_KINDS)[number];

/** Preset qualities scored on every call (build-spec §6, demo QUALS). */
export const QUALITY_KEYS = [
  "skills", "experience", "confidence", "culture_fit", "curiosity", "learning_drive", "storytelling",
] as const;
export type QualityKey = (typeof QUALITY_KEYS)[number];

export const QUALITY_LABELS: Record<QualityKey, string> = {
  skills: "Skills",
  experience: "Experience",
  confidence: "Confidence",
  culture_fit: "Culture fit",
  curiosity: "Curiosity",
  learning_drive: "Learning drive",
  storytelling: "Storytelling",
};

/** Rubric presets, ported from /demo. */
export const RUBRIC_PRESETS = [
  { id: "balanced", name: "Balanced", weights: { skills: 30, experience: 30, culture_fit: 25, confidence: 15 } },
  { id: "expert", name: "Ready expert", weights: { skills: 40, experience: 40, confidence: 10, culture_fit: 10 } },
  { id: "learner", name: "Eager learner", weights: { learning_drive: 35, culture_fit: 25, skills: 15, confidence: 15, experience: 10 } },
  { id: "culture", name: "Culture first", weights: { culture_fit: 50, skills: 20, experience: 15, confidence: 15 } },
  { id: "story", name: "Curious storyteller", weights: { confidence: 20, culture_fit: 20, skills: 15, experience: 15, curiosity: 15, storytelling: 15 } },
] as const;

/** Pick cut-offs (build-spec §2 / delta 7). */
export const PICK_CUTOFFS = { amazing: 80, good: 65, maybe: 45 } as const;

// ---------- JSON column shapes ----------
export const CultureValueSchema = z.object({ name: z.string().min(1), description: z.string().default("") });
export const FaqItemSchema = z.object({ question: z.string().min(1), answer: z.string().min(1) });
export const MustHaveSchema = z.object({ text: z.string().min(1) });
export const CustomTraitSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]*$/),
  name: z.string().min(1),
  description: z.string().default(""),
});
export const WeightsSchema = z.record(z.string(), z.number().min(0).max(100));
export const CallingHoursSchema = z.object({
  start: z.string().regex(/^\d{2}:\d{2}$/),
  end: z.string().regex(/^\d{2}:\d{2}$/),
  days: z.array(z.number().int().min(0).max(6)),
});
export const QuoteSchema = z.object({ text: z.string(), ts: z.union([z.number(), z.string()]).nullable().optional() });
export const QualityScoreSchema = z.object({
  score: z.number().int().min(1).max(5).nullable(),
  quotes: z.array(QuoteSchema),
  reason: z.string(),
});
export const MustHaveResultSchema = z.object({
  text: z.string(),
  met: z.union([z.boolean(), z.literal("unknown")]),
  quote: z.string().nullable().optional(),
});
export const ScoreFlagsSchema = z.object({
  other_role: z.object({ job_id: z.string().nullable().optional(), title: z.string().optional(), reason: z.string() }).nullable(),
  culture_standout: z.boolean(),
  wants_internship: z.boolean(),
  resume_mismatch: z.array(z.object({ claim_quote: z.string(), resume_line: z.string() })).default([]),
  hr_review: z.string().nullable().default(null),
});

export type CultureValue = z.infer<typeof CultureValueSchema>;
export type FaqItem = z.infer<typeof FaqItemSchema>;
export type MustHave = z.infer<typeof MustHaveSchema>;
export type CustomTrait = z.infer<typeof CustomTraitSchema>;
export type Weights = z.infer<typeof WeightsSchema>;
export type CallingHours = z.infer<typeof CallingHoursSchema>;
export type QualityScore = z.infer<typeof QualityScoreSchema>;
export type MustHaveResult = z.infer<typeof MustHaveResultSchema>;
export type ScoreFlags = z.infer<typeof ScoreFlagsSchema>;
