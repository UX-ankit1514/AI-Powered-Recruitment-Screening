/**
 * Multi-pass call evaluation (eval-v1). Replaces the single-shot scorer; `scoreCall` (score-call.ts)
 * is a thin compatible wrapper around `evaluateCall`.
 *
 *  (a) classify   heuristics, then a model pass: conversation | voicemail | wrong_person | no_speech | dropped.
 *                 Non-conversations stop here: nothing is scored (the caller retries the call).
 *  (b) evidence   per requirement / quality: verbatim candidate quotes (verified in code) + coverage
 *                 asked_answered | asked_weak | not_asked; must-have adjudication met | not_met | unclear.
 *  (c) score #1   each criterion independently against its own job-specific anchors (temperature 0).
 *  (e) score #2   independent second pass, reversed order, temperature 0.2. |a−b| > 1 → needs_review,
 *                 keep the more cautious (lower) pass's note; final = mean of the two.
 *  (f) summary    JD fit: per-requirement met/partial/not met, strengths, gaps, hidden fits, rationale.
 *  Not asked / no verified quote → null ("not covered"): excluded, weights renormalised, never penalised.
 * Server only (imports the gateway client).
 */
import "server-only";
import { callJson } from "./client";
import { anonymise } from "./anonymise";
import { heuristicClass, type CallClass } from "./classify-call";
import { fallbackRoleProfile, completeRoleProfile, wordOverlap } from "./role-profile";
import { IMPORTANCE_WEIGHT, type Requirement, type RoleProfile } from "./role-profile-schema";
import {
  CLASSIFY_SYSTEM,
  EVAL_PROMPT_VERSION,
  EVIDENCE_SYSTEM,
  SUMMARY_SYSTEM,
  classifyUser,
  evidenceUser,
  scoreSystemV2,
  scoreUserV2,
  summaryUser,
  type CriterionForPrompt,
} from "./prompts/evaluate";
import { quoteFound } from "./verify-quotes";
import { candidateText, clip, clipWords, normaliseText } from "./text";
import { computeJdFit, requirementStatus } from "./scoring-math";
import { describeIst, textList, toIstIso, valueList, type RoleItem, type TextItem, type TraitInput } from "./inputs";
import { languageMix } from "../fairness/groups";
import { z } from "zod";
import { ScoreCallResultSchema, type ScoreCallResult, type RequirementScore, type JdFit, type Agreement } from "./schemas";

export type OpenRoleInput = { id?: string | null; title: string; summary?: string | null };

export type EvaluateInput = {
  transcript: string;
  role: string;
  mustHaves?: TextItem[] | null;
  niceToHaves?: TextItem[] | null;
  cultureValues?: TextItem[] | null;
  openRoles?: (RoleItem | OpenRoleInput)[] | null;
  resumeNote?: string | null;
  customTraits?: TraitInput[] | null;
  candidateName?: string | null;
  callTime?: Date | string | null;
  model?: string;
  /** Job's current role profile; a deterministic one is built from the rubric when missing. */
  roleProfile?: RoleProfile | null;
  /** Classification already made by the webhook (skips pass a's model call when conversation). */
  knownClass?: { cls: CallClass; shortExit?: boolean; conductEnded?: boolean; gaming?: boolean; callbackAt?: string | null; reason?: string } | null;
};

export type ClassifyResult = {
  cls: CallClass;
  reason: string;
  shortExit: boolean;
  conductEnded: boolean;
  gaming: boolean;
  callbackAt: string | null;
  usedModel: boolean;
  model: string | null;
};

const CONDUCT_PREFIX = "Call ended for conduct:";
const COVERAGE = ["asked_answered", "asked_weak", "not_asked"] as const;
type Coverage = (typeof COVERAGE)[number];

// ---------------------------------------------------------------------------
// lenient model-reply schemas
const bool = z.preprocess((v) => v === true || v === "true" || v === "yes", z.boolean());
const strOrNull = z.preprocess((v) => (typeof v === "string" && v.trim() && !/^(null|n\/a|none)$/i.test(v.trim()) ? v.trim() : null), z.string().nullable());
const str = z.preprocess((v) => (typeof v === "string" ? v.trim() : v == null ? "" : String(v)), z.string());
const quoteList = z.preprocess(
  (v) => (Array.isArray(v) ? v : typeof v === "string" && v.trim() ? [v] : []),
  z.array(z.unknown()).transform((a) =>
    a
      .map((x) => (typeof x === "string" ? x : x && typeof x === "object" && "text" in x ? String((x as { text: unknown }).text ?? "") : ""))
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 3),
  ),
);
const score1to5 = z.preprocess((v) => {
  if (v == null || v === "") return null;
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 1 && n <= 5 ? n : null;
}, z.number().int().min(1).max(5).nullable());

const RawClassify = z.object({
  call_class: z.preprocess((v) => (typeof v === "string" ? v.trim().toLowerCase() : v), z.enum(["conversation", "voicemail", "wrong_person", "no_speech", "dropped"])),
  reason: str.optional().default(""),
  short_exit: bool.optional().default(false),
  conduct_ended: bool.optional().default(false),
  gaming_attempt: bool.optional().default(false),
  callback_requested_at: strOrNull.optional().default(null),
});

function makeRawEvidence(criteriaIds: string[], checkIds: string[]) {
  return z.object({
    evidence: z
      .record(
        z.string(),
        z.object({
          coverage: z.preprocess((v) => (typeof v === "string" && (COVERAGE as readonly string[]).includes(v) ? v : "not_asked"), z.enum(COVERAGE)),
          quotes: quoteList.optional().default([]),
          note: str.optional().default(""),
        }),
      )
      .superRefine((e, ctx) => {
        const missing = criteriaIds.filter((k) => !(k in e));
        if (missing.length) ctx.addIssue({ code: "custom", message: `evidence missing ids: ${missing.join(", ")}` });
      }),
    must_haves: z
      .record(
        z.string(),
        z.object({
          status: z.preprocess((v) => (v === "met" || v === true ? "met" : v === "not_met" || v === false ? "not_met" : "unclear"), z.enum(["met", "not_met", "unclear"])),
          quote: strOrNull.optional().default(null),
        }),
      )
      .optional()
      .default({})
      .superRefine((m, ctx) => {
        const missing = checkIds.filter((k) => !(k in m));
        if (missing.length) ctx.addIssue({ code: "custom", message: `must_haves missing ids: ${missing.join(", ")}` });
      }),
    flags: z
      .object({
        other_role: z
          .preprocess((v) => (typeof v === "string" ? (v.trim() ? { title: v.trim(), reason: "" } : null) : (v ?? null)), z.object({ title: str, reason: str.optional().default("") }).nullable())
          .optional()
          .default(null),
        culture_standout: bool.optional().default(false),
        wants_internship: bool.optional().default(false),
        resume_mismatch: z
          .array(z.preprocess((v) => (typeof v === "string" ? { claim_quote: v, resume_line: "" } : v), z.object({ claim_quote: str, resume_line: str.optional().default("") })))
          .catch([]),
        hr_review: strOrNull.optional().default(null),
      })
      .optional()
      .default({ other_role: null, culture_standout: false, wants_internship: false, resume_mismatch: [], hr_review: null }),
    profile_updates: z.record(z.string(), z.unknown()).nullable().catch(null).optional().default(null),
  });
}

function makeRawScores(ids: string[]) {
  return z.object({
    scores: z
      .record(z.string(), z.object({ score: score1to5, justification: str.optional().default("") }))
      .superRefine((s, ctx) => {
        const missing = ids.filter((k) => !(k in s));
        if (missing.length) ctx.addIssue({ code: "custom", message: `scores missing ids: ${missing.join(", ")}` });
      }),
  });
}

const RawSummary = z.object({
  strengths: z.array(str).catch([]),
  gaps: z.array(str).catch([]),
  hidden_fits: z
    .array(z.preprocess((v) => (typeof v === "string" ? { title: v, reason: "" } : v), z.object({ title: str, reason: str.optional().default("") })))
    .catch([]),
  rationale: str.optional().default(""),
  summary: str.optional().default(""),
});

// ---------------------------------------------------------------------------
function normaliseCallback(raw: string | null, callTime: Date): string | null {
  if (!raw) return null;
  let s = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(s)) s = `${s.length === 16 ? `${s}:00` : s}+05:30`;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  if (d.getTime() < callTime.getTime() - 5 * 60_000 || d.getTime() > callTime.getTime() + 60 * 86_400_000) return null;
  return toIstIso(d);
}

type Prepared = {
  transcript: string;
  hay: string;
  resumeNote: string | null;
  when: Date;
  role: string;
  profile: RoleProfile;
  openRoles: { id: string | null; title: string; summary: string }[];
};

function prepare(input: EvaluateInput): Prepared {
  const name = input.candidateName?.trim() || null;
  const transcript = anonymise(clip(input.transcript, 60_000), name);
  if (!transcript.trim()) throw new Error("transcript is empty");
  const callTime = input.callTime ? new Date(input.callTime) : new Date();
  const when = Number.isNaN(callTime.getTime()) ? new Date() : callTime;
  const base =
    input.roleProfile ??
    fallbackRoleProfile({ title: input.role, mustHaves: input.mustHaves, niceToHaves: input.niceToHaves, customTraits: input.customTraits });
  const profile = reconcileChecks(completeRoleProfile(base, input.customTraits), textList(input.mustHaves));
  const openRoles = (input.openRoles ?? [])
    .map((r) => {
      if (typeof r === "string") return { id: null, title: r.trim(), summary: "" };
      const o = r as OpenRoleInput;
      return { id: o.id ?? null, title: String(o.title ?? "").trim(), summary: clip(o.summary ?? "", 300) };
    })
    .filter((r) => r.title);
  return {
    transcript,
    hay: normaliseText(candidateText(transcript)),
    resumeNote: input.resumeNote ? anonymise(clip(input.resumeNote, 2000), name) : null,
    when,
    role: clip(input.role, 160) || "the advertised role",
    profile,
    openRoles,
  };
}

/** Rubric must-haves always have a check, even if the role profile predates them. */
function reconcileChecks(profile: RoleProfile, mustHaves: string[]): RoleProfile {
  const checks = [...profile.must_have_checks];
  const used = new Set([...profile.requirements.map((r) => r.id), ...checks.map((c) => c.id), ...Object.keys(profile.quality_anchors)]);
  mustHaves.forEach((text, i) => {
    if (checks.some((c) => wordOverlap(c.text, text) >= 0.6)) return;
    let id = `mh_${i + 1}`;
    while (used.has(id)) id += "_x";
    used.add(id);
    checks.push({ id, text: clip(text, 300), check: clip(`Ask directly and listen for a clear answer about: ${text}`, 300) });
  });
  return { ...profile, must_have_checks: checks };
}

// ---------------------------------------------------------------------------
// (a) classify
export async function classifyCall(input: Pick<EvaluateInput, "transcript" | "role" | "candidateName" | "callTime" | "model">): Promise<ClassifyResult> {
  const name = input.candidateName?.trim() || null;
  const transcript = anonymise(clip(input.transcript ?? "", 60_000), name);
  const h = heuristicClass(transcript);
  const when = input.callTime ? new Date(input.callTime) : new Date();
  const callTime = Number.isNaN(when.getTime()) ? new Date() : when;
  if (h.confident && h.cls !== "conversation") {
    return { cls: h.cls, reason: h.reason, shortExit: false, conductEnded: false, gaming: false, callbackAt: null, usedModel: false, model: null };
  }
  const { data, model } = await callJson({
    system: CLASSIFY_SYSTEM,
    user: classifyUser({ transcript, role: clip(input.role, 160) || "the advertised role", callTimeIst: describeIst(callTime) }),
    schema: RawClassify,
    maxTokens: 300,
    temperature: 0,
    timeoutMs: 45_000,
    model: input.model,
  });
  let cls: CallClass = data.call_class;
  let reason = clip(data.reason, 200);
  // A long two-way exchange is a conversation whatever the model says (the model can over-read a
  // candidate saying "call me later" as no conversation).
  if (cls !== "conversation" && h.confident && h.cls === "conversation") {
    cls = "conversation";
    reason = "A real back-and-forth with the candidate.";
  }
  return {
    cls,
    reason,
    shortExit: data.short_exit,
    conductEnded: data.conduct_ended,
    gaming: data.gaming_attempt,
    callbackAt: normaliseCallback(data.callback_requested_at, callTime),
    usedModel: true,
    model,
  };
}

// ---------------------------------------------------------------------------
type Criterion = CriterionForPrompt & { kind: "requirement" | "quality"; importance?: Requirement["importance"]; quality?: string };

function criteriaOf(profile: RoleProfile): Criterion[] {
  const reqs: Criterion[] = profile.requirements.map((r) => ({
    id: r.id,
    label: r.text,
    hint: r.evidence_hint,
    anchors: r.anchors,
    kind: "requirement",
    importance: r.importance,
    quality: r.quality,
  }));
  const quals: Criterion[] = Object.entries(profile.quality_anchors).map(([k, q]) => ({ id: k, label: q.name, hint: q.anchors["3"], anchors: q.anchors, kind: "quality" }));
  return [...reqs, ...quals];
}

type Evidence = { coverage: Coverage; quotes: string[]; note: string };

function verifiedQuotes(quotes: string[], hay: string): string[] {
  const seen = new Set<string>();
  return quotes.filter((q) => {
    const n = normaliseText(q);
    if (seen.has(n) || !quoteFound(q, hay)) return false;
    seen.add(n);
    return true;
  });
}

function round1(n: number) {
  return Math.round(n * 10) / 10;
}

/** Final 1–5 for a criterion from two passes. */
export function combinePasses(a: number | null, b: number | null): { score: number | null; disagree: boolean; diff: number } {
  if (a === null && b === null) return { score: null, disagree: false, diff: 0 };
  if (a === null || b === null) return { score: (a ?? b) as number, disagree: true, diff: 5 };
  const diff = Math.abs(a - b);
  return { score: round1((a + b) / 2), disagree: diff > 1, diff };
}

/** Quality score folded with the requirements mapped to it (see scoring-math header). */
export function foldQuality(direct: number | null, mapped: { score: number | null; importance: Requirement["importance"] }[]): number | null {
  let sum = 0;
  let w = 0;
  if (direct !== null) {
    sum += direct * 2;
    w += 2;
  }
  for (const m of mapped) {
    if (m.score === null) continue;
    const iw = IMPORTANCE_WEIGHT[m.importance];
    sum += m.score * iw;
    w += iw;
  }
  return w ? round1(sum / w) : null;
}

export type EvaluateTrace = { calls: number; passes: string[] };

export async function evaluateCall(input: EvaluateInput, trace?: EvaluateTrace): Promise<ScoreCallResult> {
  const p = prepare(input);
  const note = (pass: string) => {
    if (trace) {
      trace.calls++;
      trace.passes.push(pass);
    }
  };
  const models = new Set<string>();

  // ---- (a) classify ----
  let cls: ClassifyResult;
  if (input.knownClass) {
    cls = {
      cls: input.knownClass.cls,
      reason: input.knownClass.reason ?? "",
      shortExit: !!input.knownClass.shortExit,
      conductEnded: !!input.knownClass.conductEnded,
      gaming: !!input.knownClass.gaming,
      callbackAt: input.knownClass.callbackAt ?? null,
      usedModel: false,
      model: null,
    };
  } else {
    cls = await classifyCall({ transcript: input.transcript, role: input.role, candidateName: input.candidateName, callTime: p.when, model: input.model });
    if (cls.usedModel) note("classify");
    if (cls.model) models.add(cls.model);
  }
  const lang = languageMix(p.transcript);
  if (cls.cls !== "conversation") return notConversationResult(p, cls, lang);

  // ---- (b) evidence ----
  const criteria = criteriaOf(p.profile);
  const checks = p.profile.must_have_checks;
  const ev = await callJson({
    system: EVIDENCE_SYSTEM,
    user: evidenceUser({
      transcript: p.transcript,
      role: p.role,
      criteria,
      checks,
      cultureValues: valueList(input.cultureValues),
      openRoles: p.openRoles.map((r) => r.title),
      resumeNote: p.resumeNote,
    }),
    schema: makeRawEvidence(
      criteria.map((c) => c.id),
      checks.map((c) => c.id),
    ),
    maxTokens: 4000,
    temperature: 0,
    timeoutMs: 120_000,
    model: input.model,
  });
  note("evidence");
  models.add(ev.model);

  const evidence: Record<string, Evidence> = {};
  for (const c of criteria) {
    const raw = ev.data.evidence[c.id] ?? { coverage: "not_asked" as Coverage, quotes: [], note: "" };
    const quotes = verifiedQuotes(raw.quotes, p.hay);
    // No verifiable candidate words → nothing to score on; an "answered" claim degrades to weak.
    const coverage: Coverage = raw.coverage === "not_asked" ? "not_asked" : quotes.length ? raw.coverage : "asked_weak";
    evidence[c.id] = { coverage, quotes, note: clip(raw.note, 240) };
  }
  const coverage = Object.fromEntries(criteria.map((c) => [c.id, evidence[c.id].coverage])) as Record<string, Coverage>;

  // ---- (d) must-have adjudication (needs a verified quote for met / not_met) ----
  const mustHaveResults = checks.map((c) => {
    const r = ev.data.must_haves[c.id];
    const ok = !!r?.quote && quoteFound(r.quote, p.hay);
    const status = ok && r ? r.status : "unclear";
    return {
      id: c.id,
      text: c.text,
      status,
      met: status === "met" ? true : status === "not_met" ? false : ("unknown" as const),
      quote: ok && status !== "unclear" ? r!.quote : null,
    };
  });

  // ---- (c) + (e) two independent scoring passes ----
  const scorable = criteria.filter((c) => evidence[c.id].coverage !== "not_asked" && evidence[c.id].quotes.length > 0);
  const scoreArgs = (list: Criterion[]) => ({
    role: p.role,
    transcript: p.transcript,
    criteria: list.map((c) => ({ ...c, quotes: evidence[c.id].quotes, note: evidence[c.id].note, coverage: evidence[c.id].coverage })),
  });
  const ids = scorable.map((c) => c.id);
  type Pass = Record<string, { score: number | null; justification: string }>;
  let passA: Pass = {};
  let passB: Pass = {};
  if (scorable.length) {
    const [a, b] = await Promise.all([
      callJson({ system: scoreSystemV2(1), user: scoreUserV2(scoreArgs(scorable)), schema: makeRawScores(ids), maxTokens: 3000, temperature: 0, timeoutMs: 120_000, model: input.model }),
      callJson({
        system: scoreSystemV2(2),
        user: scoreUserV2(scoreArgs([...scorable].reverse())),
        schema: makeRawScores(ids),
        maxTokens: 3000,
        temperature: 0.2,
        timeoutMs: 120_000,
        model: input.model,
      }),
    ]);
    note("score-1");
    note("score-2");
    models.add(a.model);
    models.add(b.model);
    passA = a.data.scores;
    passB = b.data.scores;
  }

  const disagreements: Agreement["disagreements"] = [];
  let maxDiff = 0;
  let agreed = 0;
  const finalOf: Record<string, { score: number | null; a: number | null; b: number | null; justification: string }> = {};
  for (const c of criteria) {
    if (!ids.includes(c.id)) {
      finalOf[c.id] = { score: null, a: null, b: null, justification: evidence[c.id].coverage === "not_asked" ? "Not covered on the call." : "No clear answer in the candidate's own words." };
      continue;
    }
    const a = passA[c.id]?.score ?? null;
    const b = passB[c.id]?.score ?? null;
    const comb = combinePasses(a, b);
    // Keep the more cautious note: the lower-scoring pass's justification when they disagree.
    const ja = passA[c.id]?.justification ?? "";
    const jb = passB[c.id]?.justification ?? "";
    const justification = clip(comb.disagree ? ((a ?? 6) <= (b ?? 6) ? ja || jb : jb || ja) : ja || jb, 240);
    if (comb.disagree) disagreements.push({ id: c.id, a, b, note: justification });
    else if (comb.score !== null) agreed++;
    if (a !== null && b !== null) maxDiff = Math.max(maxDiff, comb.diff);
    finalOf[c.id] = { score: comb.score, a, b, justification };
  }
  const scoredCount = agreed + disagreements.length;
  const agreement: Agreement = {
    passes: 2,
    max_diff: maxDiff,
    agreement_rate: scoredCount ? round2(agreed / scoredCount) : 1,
    disagreements,
  };

  // ---- requirement scores ----
  const requirement_scores: Record<string, RequirementScore> = {};
  for (const r of p.profile.requirements) {
    const f = finalOf[r.id];
    let status = requirementStatus(f.score);
    // A must requirement whose matching must-have check failed is not met, whatever the score.
    const check = mustHaveResults.find((m) => wordOverlap(m.text, r.text) >= 0.5);
    if (r.importance === "must" && check?.status === "not_met") status = "not_met";
    requirement_scores[r.id] = {
      text: r.text,
      importance: r.importance,
      quality: r.quality,
      score: f.score,
      pass_scores: [f.a, f.b],
      justification: f.justification,
      quotes: evidence[r.id].quotes.map((text) => ({ text, ts: null })),
      status,
    };
  }

  // ---- legacy qualities (folded with mapped requirements) ----
  const qualities: ScoreCallResult["qualities"] = {};
  for (const [key, qa] of Object.entries(p.profile.quality_anchors)) {
    const direct = finalOf[key]?.score ?? null;
    // Logistics (notice period, location…) are gates, not ability: they count in JD fit only.
    const mapped = p.profile.requirements.filter((r) => r.quality === key && r.kind !== "logistics").map((r) => ({ score: requirement_scores[r.id].score, importance: r.importance, id: r.id }));
    const score = foldQuality(direct, mapped);
    const quotes = [...evidence[key].quotes, ...mapped.flatMap((m) => evidence[m.id].quotes)].filter((q, i, a) => a.indexOf(q) === i).slice(0, 3);
    const mappedNames = mapped.filter((m) => m.score !== null).map((m) => requirement_scores[m.id].text);
    const reason =
      score === null
        ? `${qa.name}: not covered on the call.`
        : clip([direct !== null ? finalOf[key].justification : "", mappedNames.length ? `Includes job requirements: ${mappedNames.join("; ")}.` : ""].filter(Boolean).join(" "), 300);
    qualities[key] = { score, reason, quotes: quotes.map((text) => ({ text, ts: null })) };
  }

  // ---- flags ----
  const f = ev.data.flags;
  const matchRole = (title: string) => p.openRoles.find((r) => r.title.toLowerCase() === title.toLowerCase());
  const flags = {
    other_role: f.other_role ? { job_id: matchRole(f.other_role.title)?.id ?? null, title: matchRole(f.other_role.title)?.title ?? f.other_role.title, reason: f.other_role.reason } : null,
    culture_standout: f.culture_standout,
    wants_internship: f.wants_internship,
    resume_mismatch: f.resume_mismatch.filter((m) => quoteFound(m.claim_quote, p.hay)),
    hr_review: f.hr_review ?? (cls.gaming ? "Candidate tried to influence the evaluation" : null),
  };

  // ---- confidence ----
  const confidence = confidenceOf(p.profile, coverage, agreement);
  const needsReview = disagreements.length > 0 || confidence < 0.35;

  // ---- (f) JD fit summary ----
  const conduct = cls.conductEnded;
  const shortExit = cls.shortExit || conduct;
  const notCovered = criteria.filter((c) => finalOf[c.id].score === null && (c.kind === "requirement" ? c.importance !== "nice" : true)).map((c) => c.label);
  const fitReqs: JdFit["requirements"] = p.profile.requirements.map((r) => ({
    id: r.id,
    text: r.text,
    importance: r.importance,
    status: requirement_scores[r.id].status,
    score: requirement_scores[r.id].score,
    quote: requirement_scores[r.id].quotes[0]?.text ?? null,
    justification: requirement_scores[r.id].justification,
  }));
  let summaryOut: z.infer<typeof RawSummary> | null = null;
  try {
    const lines = criteria.map((c) => {
      const s = finalOf[c.id];
      return `- ${c.label}${c.kind === "requirement" ? ` [${c.importance}]` : " [quality]"}: ${s.score === null ? "not covered" : s.score} — ${s.justification}`;
    });
    const out = await callJson({
      system: SUMMARY_SYSTEM,
      user: summaryUser({
        role: p.role,
        lines,
        mustHaves: mustHaveResults.map((m) => `${m.text}: ${m.status}`),
        openRoles: p.openRoles.map((r) => ({ title: r.title, summary: r.summary })),
        conductEnded: conduct,
        shortExit,
      }),
      schema: RawSummary,
      maxTokens: 900,
      temperature: 0,
      timeoutMs: 60_000,
      model: input.model,
    });
    note("summary");
    models.add(out.model);
    summaryOut = out.data;
  } catch {
    summaryOut = null; // deterministic fallback below; the scores themselves are already sound
  }
  const ranked = fitReqs.filter((r) => r.score !== null).sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const strengths = (summaryOut?.strengths.length ? summaryOut.strengths : ranked.filter((r) => r.status === "met").slice(0, 3).map((r) => r.text)).map((s) => clipWords(s, 15)).slice(0, 3);
  const gaps = (
    summaryOut?.gaps.length
      ? summaryOut.gaps
      : [...mustHaveResults.filter((m) => m.status === "not_met").map((m) => `Must-have not met: ${m.text}`), ...[...ranked].reverse().filter((r) => r.status !== "met").map((r) => r.text)]
  )
    .map((s) => clipWords(s, 15))
    .slice(0, 3);
  const hidden = (summaryOut?.hidden_fits ?? [])
    .map((h) => ({ job_id: matchRole(h.title)?.id ?? null, title: matchRole(h.title)?.title ?? h.title, reason: clip(h.reason, 240) }))
    .filter((h) => matchRole(h.title))
    .slice(0, 3);
  if (!flags.other_role && hidden[0]) flags.other_role = hidden[0];
  const fitPct = computeJdFit(requirement_scores);
  const rationale = clipWords(
    summaryOut?.rationale ||
      `JD fit ${fitPct ?? "not scored"}${fitPct !== null ? "%" : ""}: ${fitReqs.filter((r) => r.status === "met").length} of ${fitReqs.length} requirements met${notCovered.length ? `, ${notCovered.length} not covered on the call` : ""}.`,
    80,
  );
  let summary = clipWords((summaryOut?.summary || rationale).replace(/\s+/g, " "), 60);
  if (conduct && !summary.startsWith(CONDUCT_PREFIX)) summary = clipWords(`${CONDUCT_PREFIX} ${summary}`, 60);

  const jd_fit: JdFit = { fit_pct: fitPct, requirements: fitReqs, strengths, gaps, hidden_fits: hidden, rationale, not_covered: notCovered.slice(0, 20) };

  return ScoreCallResultSchema.parse({
    qualities,
    must_have_results: mustHaveResults,
    flags,
    summary,
    profile_updates: ev.data.profile_updates && Object.keys(ev.data.profile_updates).length ? ev.data.profile_updates : null,
    short_exit: shortExit,
    conduct_ended: conduct,
    callback_requested_at: cls.callbackAt,
    model_version: [...models].join(",") || "unknown",
    prompt_version: EVAL_PROMPT_VERSION,
    call_class: "conversation",
    call_class_reason: cls.reason,
    requirement_scores,
    coverage,
    agreement,
    jd_fit,
    confidence,
    needs_review: needsReview,
    language_mix: lang,
    role_profile_version: p.profile.version,
  });
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

/**
 * Confidence 0–1 = coverage × (0.6 + 0.4 × agreement)  — agreement only counts for what was covered,
 * so two passes agreeing on a 3-minute call does not make it a confident read.
 *  coverage  = importance-weighted share of must/core requirements and quality criteria that were
 *              answered (asked_answered = 1, asked_weak = 0.5, not_asked = 0);
 *  agreement = share of scored criteria where the two passes were within 1 point.
 */
export function confidenceOf(profile: RoleProfile, coverage: Record<string, Coverage>, agreement: Pick<Agreement, "agreement_rate">): number {
  let sum = 0;
  let w = 0;
  const val = (c: Coverage | undefined) => (c === "asked_answered" ? 1 : c === "asked_weak" ? 0.5 : 0);
  for (const r of profile.requirements) {
    if (r.importance === "nice") continue;
    const iw = IMPORTANCE_WEIGHT[r.importance];
    sum += val(coverage[r.id]) * iw;
    w += iw;
  }
  for (const k of Object.keys(profile.quality_anchors)) {
    sum += val(coverage[k]);
    w += 1;
  }
  const cov = w ? sum / w : 0;
  return round2(Math.min(1, Math.max(0, cov * (0.6 + 0.4 * agreement.agreement_rate))));
}

function notConversationResult(p: Prepared, cls: ClassifyResult, lang: ScoreCallResult["language_mix"]): ScoreCallResult {
  const qualities = Object.fromEntries(Object.keys(p.profile.quality_anchors).map((k) => [k, { score: null, reason: "Not a conversation with the candidate.", quotes: [] }]));
  return ScoreCallResultSchema.parse({
    qualities,
    must_have_results: p.profile.must_have_checks.map((c) => ({ id: c.id, text: c.text, status: "unclear", met: "unknown", quote: null })),
    flags: { other_role: null, culture_standout: false, wants_internship: false, resume_mismatch: [], hr_review: null },
    summary: clipWords(`Not scored: ${cls.reason || cls.cls}`, 60),
    profile_updates: null,
    short_exit: false,
    conduct_ended: false,
    callback_requested_at: null,
    model_version: cls.model ?? "heuristic",
    prompt_version: EVAL_PROMPT_VERSION,
    call_class: cls.cls,
    call_class_reason: cls.reason,
    confidence: 0,
    needs_review: false,
    language_mix: lang,
    role_profile_version: p.profile.version,
  });
}

