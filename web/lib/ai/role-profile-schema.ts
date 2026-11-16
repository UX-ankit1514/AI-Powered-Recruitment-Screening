/**
 * Role profile: the job-specific picture of "what good looks like" that drives the interview plan
 * and the evaluation. Pure (zod + helpers); safe on server and client.
 *
 *  - requirements[]   {id, text, kind, importance, evidence_hint, question, probe, quality, anchors{1..5}}
 *  - must_have_checks {id, text, check}           must-haves as checkable criteria ("how to verify on a call")
 *  - quality_anchors  {<quality key>: {name, anchors{1..5}, question}}  preset qualities + custom traits
 *
 * The requirement → quality mapping is `requirement.quality` (one rubric quality key per requirement).
 */
import { z } from "zod";
import { PRESET_QUALITY_KEYS } from "./scoring-math";

export const REQUIREMENT_KINDS = ["skill", "experience", "behaviour", "logistics"] as const;
export const IMPORTANCE = ["must", "core", "nice"] as const;
export type RequirementKind = (typeof REQUIREMENT_KINDS)[number];
export type Importance = (typeof IMPORTANCE)[number];

/** Requirement weight in the JD fit and when folding requirements into their quality. */
export const IMPORTANCE_WEIGHT: Record<Importance, number> = { must: 3, core: 2, nice: 1 };

const line = (max: number) => z.string().trim().min(1).max(max);
export type Anchors = Record<"1" | "2" | "3" | "4" | "5", string>;
const LEVELS = ["1", "2", "3", "4", "5"] as const;
export const AnchorsSchema = z
  .record(z.string(), z.string().trim().max(300, "Keep each level under 300 characters"))
  .superRefine((a, ctx) => {
    if (!LEVELS.every((k) => typeof a[k] === "string" && a[k].trim())) ctx.addIssue({ code: "custom", message: "Give a description for every level 1 to 5" });
    if (Object.keys(a).some((k) => !(LEVELS as readonly string[]).includes(k))) ctx.addIssue({ code: "custom", message: "Levels are 1 to 5 only" });
  })
  .transform((a) => Object.fromEntries(LEVELS.map((k) => [k, a[k]])) as Anchors);

const idSchema = z.string().regex(/^[a-z][a-z0-9_]{0,39}$/, "ids are lowercase letters, digits and _");
const qualityKey = z.string().regex(/^[a-z][a-z0-9_]{0,39}$/);

export const RequirementSchema = z
  .object({
    id: idSchema,
    text: line(200),
    kind: z.enum(REQUIREMENT_KINDS),
    importance: z.enum(IMPORTANCE),
    evidence_hint: z.string().trim().max(300).default(""),
    question: z.string().trim().max(300).default(""),
    probe: z.string().trim().max(300).default(""),
    quality: qualityKey,
    anchors: AnchorsSchema,
  })
  .strict();
export type Requirement = z.infer<typeof RequirementSchema>;

export const MustHaveCheckSchema = z.object({ id: idSchema, text: line(300), check: line(300) }).strict();
export type MustHaveCheck = z.infer<typeof MustHaveCheckSchema>;

export const QualityAnchorSchema = z
  .object({ name: line(60), anchors: AnchorsSchema, question: z.string().trim().max(300).default("") })
  .strict();
export type QualityAnchor = z.infer<typeof QualityAnchorSchema>;

export const RoleProfileBodySchema = z
  .object({
    requirements: z.array(RequirementSchema).min(1, "Add at least one requirement").max(30),
    must_have_checks: z.array(MustHaveCheckSchema).max(20).default([]),
    quality_anchors: z.record(qualityKey, QualityAnchorSchema),
  })
  .strict()
  .superRefine((p, ctx) => {
    const ids = [...p.requirements.map((r) => r.id), ...p.must_have_checks.map((m) => m.id)];
    const dup = ids.find((id, i) => ids.indexOf(id) !== i);
    if (dup) ctx.addIssue({ code: "custom", path: ["requirements"], message: `Two items share the id "${dup}"` });
    for (const k of Object.keys(p.quality_anchors)) {
      if (ids.includes(k)) ctx.addIssue({ code: "custom", path: ["quality_anchors", k], message: `"${k}" is also a requirement id` });
    }
  });
export type RoleProfileBody = z.infer<typeof RoleProfileBodySchema>;

export type RoleProfile = RoleProfileBody & {
  version: number;
  source: "generated" | "edited" | "fallback";
};

// ---------------------------------------------------------------------------
// Generic anchors for the preset qualities (used when a job has no profile yet, and as the base
// the generator makes job-specific).
export const GENERIC_QUALITY_ANCHORS: Record<string, { name: string; anchors: Anchors; question: string }> = {
  skills: {
    name: "Skills",
    question: "Walk me through how you actually do the core work of this role, step by step.",
    anchors: {
      "1": "Names no relevant skill, or only lists buzzwords with nothing behind them.",
      "2": "Mentions relevant skills but cannot say how they used them.",
      "3": "Describes using the main skills on real work with some concrete detail.",
      "4": "Explains how they apply the skills with specific steps, tools and results.",
      "5": "Shows deep, transferable mastery: trade-offs, mistakes fixed, teaches others.",
    },
  },
  experience: {
    name: "Experience",
    question: "Tell me about the piece of work you owned end to end that is closest to this role.",
    anchors: {
      "1": "No relevant work described.",
      "2": "Relevant work mentioned only vaguely or as a bystander.",
      "3": "At least one relevant piece of work with their own part in it made clear.",
      "4": "Several relevant pieces of work with clear ownership, scale and outcomes.",
      "5": "Directly comparable work at greater scope, with measurable impact they drove.",
    },
  },
  confidence: {
    name: "Confidence",
    question: "",
    anchors: {
      "1": "Avoids answering or cannot give any example even when asked simply.",
      "2": "Answers are mostly vague; examples only after several prompts.",
      "3": "Gives direct answers and at least one real example.",
      "4": "Clear, direct and owns their answers, including what went wrong.",
      "5": "Consistently crisp, specific and self-aware across topics.",
    },
  },
  culture_fit: {
    name: "Culture fit",
    question: "Tell me about a time you showed how you like to work with a team.",
    anchors: {
      "1": "Nothing said that relates to how the company works, or clearly opposed to it.",
      "2": "Agrees with the values in general words but gives no example.",
      "3": "One example that matches a company value.",
      "4": "Several examples that match the company's values and working style.",
      "5": "Values show up naturally throughout, with strong specific stories.",
    },
  },
  curiosity: {
    name: "Curiosity",
    question: "What is something you got curious about recently and dug into?",
    anchors: {
      "1": "Shows no interest in learning more about the work or the role.",
      "2": "Polite generic interest only.",
      "3": "Asks a relevant question or describes exploring something on their own.",
      "4": "Several thoughtful questions or self-driven explorations.",
      "5": "Persistent, deep curiosity that led to something useful.",
    },
  },
  learning_drive: {
    name: "Learning drive",
    question: "What is the last new skill you taught yourself, and how did you go about it?",
    anchors: {
      "1": "No sign of learning anything new.",
      "2": "Says they like learning but gives no example.",
      "3": "One clear example of learning something new for work.",
      "4": "Regular, self-directed learning with examples and how they applied it.",
      "5": "Fast, structured learning that clearly changed what they can do.",
    },
  },
  storytelling: {
    name: "Storytelling",
    question: "",
    anchors: {
      "1": "Cannot describe any experience as a story.",
      "2": "Stories lack a clear situation, action or result.",
      "3": "At least one story with situation, action and result.",
      "4": "Clear, specific stories that are easy to follow.",
      "5": "Vivid, well-structured stories with a clear point every time.",
    },
  },
};

export function genericTraitAnchors(name: string, description: string): Anchors {
  const what = description.trim() || name;
  return {
    "1": `No sign of ${name.toLowerCase()} in anything they said.`,
    "2": `Claims ${name.toLowerCase()} in general words, with no example.`,
    "3": `One real example that shows: ${what}`,
    "4": `Several specific examples that show: ${what}`,
    "5": `Strong, repeated, specific evidence of ${name.toLowerCase()} with a clear result.`,
  };
}

export function isPresetQuality(k: string): boolean {
  return (PRESET_QUALITY_KEYS as readonly string[]).includes(k);
}
