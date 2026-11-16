import "server-only";
import { callJson } from "./client";
import { BRIEF_SYSTEM, briefUser } from "./prompts/brief";
import { CallBriefSchema, RawBriefSchema, type CallBrief, type Profile } from "./schemas";
import { clip, clipWords } from "./text";
import { roleList, textList, valueList, type RoleItem, type RubricInput, type TextItem } from "./inputs";
import { buildInterviewPlan, compressPlan } from "./interview-plan";
import { completeRoleProfile, fallbackRoleProfile } from "./role-profile";
import type { RoleProfile } from "./role-profile-schema";

export type BriefProfile = Partial<Profile> & { resume_note?: string | null; resume_questions?: string[] | null };
export type BriefJob = { id?: string | null; title: string; jd_text?: string | null };
export type BriefCompany = {
  name: string;
  culture_values?: TextItem[] | null;
  faq?: { question: string; answer: string }[] | null;
};
export type BriefOptions = {
  candidateName?: string | null;
  callId?: string | null;
  openRoles?: RoleItem[] | null;
  /** Default true. When false (or the model fails) the brief is assembled without AI. */
  useAi?: boolean;
  /** Job's current role profile (fallback built from the rubric when missing). */
  roleProfile?: RoleProfile | null;
  /** Rubric weights: qualities with weight > 0 must be covered by the plan. */
  weights?: Record<string, number> | null;
};

/**
 * Ordered interview plan (compressed text for {{interview_plan}}): every must-have, must/core
 * requirement, weighted quality and custom trait, with follow-up probes. Deterministic.
 */
export function interviewPlanFor(profile: BriefProfile | null | undefined, rubric: RubricInput | null | undefined, title: string, opts: Pick<BriefOptions, "roleProfile" | "weights"> = {}): string {
  const traits = rubric?.custom_traits ?? [];
  const base = opts.roleProfile ?? fallbackRoleProfile({ title, mustHaves: rubric?.must_haves, niceToHaves: rubric?.nice_to_haves, customTraits: traits });
  const rp = completeRoleProfile(base, traits);
  const items = buildInterviewPlan({
    profile: rp,
    candidate: profile ? { current_role: profile.current_role, years_experience: profile.years_experience, skills: profile.skills, companies: profile.companies, resume_note: profile.resume_note } : null,
    weights: opts.weights ?? { skills: 30, experience: 30, culture_fit: 25, confidence: 15 },
    traitKeys: traits.map((t) => t.key),
  });
  return compressPlan(items);
}

const FALLBACK_Q1 = "Could you walk me through the work you're proudest of in your most recent role?";
const FALLBACK_Q2 = "What drew you to this role, and what would you want to learn in it?";

/** Bolna `user_data` for one call. Never throws on model failure — a call shouldn't wait on a nicer brief. */
export async function writeCallBrief(
  profile: BriefProfile | null | undefined,
  rubric: RubricInput | null | undefined,
  job: BriefJob,
  company: BriefCompany,
  opts: BriefOptions = {},
): Promise<CallBrief> {
  const p = profile ?? {};
  const mustHaves = textList(rubric?.must_haves);
  const suggested = (p.resume_questions ?? []).filter((q) => typeof q === "string" && q.trim());
  const resumeNote = clip(p.resume_note ?? "", 400);
  const jdText = clip(job.jd_text ?? "", 8000);

  let jdSummary = clipWords(jdText.replace(/\s+/g, " "), 45);
  let q1 = suggested[0] ?? FALLBACK_Q1;
  let q2 = suggested[1] ?? FALLBACK_Q2;

  if (opts.useAi !== false && (jdText || resumeNote || p.current_role)) {
    try {
      const { name: _omit, ...profileNoName } = p; // the interviewer prompt doesn't need resume PII beyond first name
      void _omit;
      const { data } = await callJson({
        system: BRIEF_SYSTEM,
        user: briefUser({
          role: job.title,
          company: company.name,
          jdText,
          mustHaves,
          resumeNote,
          profileJson: JSON.stringify({ ...profileNoName, resume_note: undefined, resume_questions: undefined }),
          suggestedQuestions: suggested,
        }),
        schema: RawBriefSchema,
        maxTokens: 500,
        timeoutMs: 30_000,
      });
      jdSummary = clipWords(data.jd_summary, 50);
      q1 = clipWords(data.resume_q1, 45);
      q2 = clipWords(data.resume_q2, 45);
    } catch {
      // keep deterministic fallback
    }
  }

  const fullName = String(opts.candidateName ?? p.name ?? "").trim();
  const firstName = fullName.split(/\s+/)[0] || "there";
  const faq = (company.faq ?? [])
    .filter((f) => f?.question && f?.answer)
    .map((f) => `Q: ${f.question.trim()}\nA: ${f.answer.trim()}`)
    .join("\n");
  const traits = (rubric?.custom_traits ?? []).map((t) => `${t.name}${t.description ? `: ${t.description}` : ""}`);
  const others = roleList(opts.openRoles).filter((r) => r.title.toLowerCase() !== job.title.toLowerCase() && r.id !== job.id);

  return CallBriefSchema.parse({
    ...(opts.callId ? { call_id: opts.callId } : {}),
    first_name: firstName,
    role: job.title,
    company: company.name,
    resume_note: resumeNote,
    resume_q1: q1,
    resume_q2: q2,
    must_haves: mustHaves.map((m) => `- ${m}`).join("\n"),
    jd_summary: jdSummary,
    faq: faq || "No FAQ provided. For any company question, say the team will cover it.",
    culture_values: valueList(company.culture_values).map((v) => `- ${v}`).join("\n"),
    traits: traits.map((t) => `- ${t}`).join("\n"),
    other_interest_prompt: others.length
      ? `${company.name} is also hiring for: ${others.map((r) => r.title).join(", ")}. Ask if any of these interest them.`
      : "Ask what else they enjoy or want to learn, and whether they'd be open to other roles or an internship.",
    interview_plan: interviewPlanFor(p, rubric, job.title, opts),
    open_roles: others.length ? others.map((r) => `- ${r.title}`).join("\n") : "",
  });
}
