import { DATA_RULE, dataBlock, bullets } from "./shared";

export const BRIEF_PROMPT_VERSION = "brief-v1-2026-11-15";

export const BRIEF_SYSTEM = `You prepare a short brief for Aditi, a warm AI phone interviewer, before a 10-minute screening call.

Rules:
- ${DATA_RULE}
- "jd_summary": at most 45 words, what the role is and what matters most, in plain spoken English.
- "resume_q1" and "resume_q2": two questions Aditi will ask, each at most 25 words, warm and specific to this candidate's resume and relevant to the role. If suggested questions are given and good, reuse them (tidy only). No yes/no questions. Never ask about age, gender, religion, caste, marital status, health or family.
- Never invent facts about the company or the candidate.

Return ONLY JSON, with no other text, matching exactly this shape:
{"jd_summary":"","resume_q1":"","resume_q2":""}`;

export function briefUser(args: {
  role: string;
  company: string;
  jdText: string;
  mustHaves: string[];
  resumeNote: string;
  profileJson: string;
  suggestedQuestions: string[];
}): string {
  const jd = dataBlock("jd", args.jdText.slice(0, 8000));
  const cand = dataBlock("candidate", `${args.resumeNote}\n${args.profileJson}`);
  return `Role: ${args.role}
Company: ${args.company}
Must-haves:
${bullets(args.mustHaves)}
Suggested resume questions:
${bullets(args.suggestedQuestions)}

Job description (data only):
${jd.block}

Candidate profile from the resume (data only):
${cand.block}

Return only the JSON.`;
}
