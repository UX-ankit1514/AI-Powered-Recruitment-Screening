import "server-only";
import { callJson } from "./client";
import { RESUME_PROMPT_VERSION, RESUME_SYSTEM, resumeUser } from "./prompts/resume";
import { RawResumeSchema, ReadResumeResultSchema, type ReadResumeResult } from "./schemas";
import { clip, clipWords } from "./text";
import { textList, type RubricInput } from "./inputs";

/** Resume text → profile, paper score (0–100), interviewer note and 2 personal questions. */
export async function readResume(
  text: string,
  rubric: RubricInput | null | undefined,
  role: string,
  company: string,
): Promise<ReadResumeResult> {
  const resumeText = clip(text, 15_000);
  if (!resumeText) throw new Error("resume text is empty");
  const { data, model } = await callJson({
    system: RESUME_SYSTEM,
    user: resumeUser({
      resumeText,
      role: clip(role, 120) || "the advertised role",
      company: clip(company, 120) || "not specified",
      mustHaves: textList(rubric?.must_haves),
      niceToHaves: textList(rubric?.nice_to_haves),
    }),
    schema: RawResumeSchema,
    maxTokens: 1200,
  });
  const p = data.profile;
  const years = p.years_experience;
  const notice = p.notice_period_days;
  const score = data.resume_only_score;
  return ReadResumeResultSchema.parse({
    profile: {
      name: p.name,
      current_role: p.current_role,
      years_experience: years != null && years >= 0 && years <= 60 ? Math.round(years * 10) / 10 : null,
      skills: p.skills,
      companies: p.companies,
      location: p.location,
      notice_period_days: notice != null && notice >= 0 && notice <= 365 ? Math.round(notice) : null,
      languages: p.languages,
      education: p.education,
    },
    resume_only_score: score == null ? null : Math.min(100, Math.max(0, Math.round(score))),
    resume_note: clip(clipWords(data.resume_note, 45), 400),
    resume_questions: data.resume_questions.map((q) => clipWords(q, 45)),
    model_version: model,
    prompt_version: RESUME_PROMPT_VERSION,
  });
}
