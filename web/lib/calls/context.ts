/** Everything a call needs about one candidate: job, company, current rubric, other open roles. */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "../database.types";
import { writeCallBrief } from "../ai";

type DB = SupabaseClient<Database>;
type Tables = Database["public"]["Tables"];

export type CallContext = {
  candidate: Pick<Tables["candidates"]["Row"], "id" | "company_id" | "job_id" | "name" | "phone" | "profile" | "status">;
  job: Pick<Tables["jobs"]["Row"], "id" | "company_id" | "title" | "jd_text" | "culture_values" | "faq" | "calling_hours" | "concurrency_limit" | "status">;
  company: Pick<Tables["companies"]["Row"], "id" | "name" | "culture_values" | "faq">;
  rubric: Pick<Tables["rubrics"]["Row"], "version" | "must_haves" | "custom_traits"> | null;
  openRoles: { id: string; title: string }[];
};

const asArray = <T>(v: Json | null | undefined): T[] => (Array.isArray(v) ? (v as unknown as T[]) : []);

export async function loadCallContext(db: DB, candidateId: string): Promise<CallContext | null> {
  const { data: candidate } = await db
    .from("candidates")
    .select("id, company_id, job_id, name, phone, profile, status")
    .eq("id", candidateId)
    .maybeSingle();
  if (!candidate) return null;

  const [jobQ, companyQ, rubricQ, rolesQ] = await Promise.all([
    db
      .from("jobs")
      .select("id, company_id, title, jd_text, culture_values, faq, calling_hours, concurrency_limit, status")
      .eq("id", candidate.job_id)
      .eq("company_id", candidate.company_id)
      .maybeSingle(),
    db.from("companies").select("id, name, culture_values, faq").eq("id", candidate.company_id).maybeSingle(),
    db
      .from("rubrics")
      .select("version, must_haves, custom_traits")
      .eq("job_id", candidate.job_id)
      .eq("is_current", true)
      .maybeSingle(),
    db
      .from("jobs")
      .select("id, title")
      .eq("company_id", candidate.company_id)
      .eq("status", "open")
      .neq("id", candidate.job_id)
      .limit(20),
  ]);
  if (!jobQ.data || !companyQ.data) return null;
  return {
    candidate,
    job: jobQ.data,
    company: companyQ.data,
    rubric: rubricQ.data ?? null,
    openRoles: rolesQ.data ?? [],
  };
}

/** Job-level culture values / FAQ win over the company's when set. */
export function cultureValuesOf(ctx: CallContext) {
  const job = asArray<{ name?: string; description?: string }>(ctx.job.culture_values);
  return job.length ? job : asArray<{ name?: string; description?: string }>(ctx.company.culture_values);
}
export function faqOf(ctx: CallContext) {
  const job = asArray<{ question: string; answer: string }>(ctx.job.faq);
  return job.length ? job : asArray<{ question: string; answer: string }>(ctx.company.faq);
}

type ProfileJson = { resume_note?: string | null; resume_questions?: string[] | null } & Record<string, unknown>;
export function profileOf(ctx: CallContext): ProfileJson {
  const p = ctx.candidate.profile;
  return p && typeof p === "object" && !Array.isArray(p) ? (p as ProfileJson) : {};
}
export function resumeNoteOf(ctx: CallContext): string | null {
  const n = profileOf(ctx).resume_note;
  return typeof n === "string" && n.trim() ? n : null;
}
export function customTraitsOf(ctx: CallContext) {
  return asArray<{ key: string; name: string; description?: string | null }>(ctx.rubric?.custom_traits).filter(
    (t) => t && typeof t.name === "string",
  );
}
export function mustHavesOf(ctx: CallContext) {
  return asArray<string | { text?: string }>(ctx.rubric?.must_haves);
}

/** Bolna user_data (bolna/app-agent.md §1): every key present, all strings. */
const USER_DATA_KEYS = [
  "call_id",
  "first_name",
  "role",
  "company",
  "jd_summary",
  "resume_note",
  "resume_q1",
  "resume_q2",
  "must_haves",
  "culture_values",
  "faq",
  "traits",
  "other_interest_prompt",
] as const;

export async function buildUserData(ctx: CallContext, callId: string): Promise<Record<string, string>> {
  const profile = profileOf(ctx);
  const brief = await writeCallBrief(
    profile as Parameters<typeof writeCallBrief>[0],
    { must_haves: mustHavesOf(ctx), custom_traits: customTraitsOf(ctx) },
    { id: ctx.job.id, title: ctx.job.title, jd_text: ctx.job.jd_text },
    { name: ctx.company.name, culture_values: cultureValuesOf(ctx), faq: faqOf(ctx) },
    { candidateName: ctx.candidate.name, callId, openRoles: ctx.openRoles },
  );
  const raw = brief as unknown as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const k of USER_DATA_KEYS) out[k] = typeof raw[k] === "string" ? (raw[k] as string) : "";
  out.call_id = callId;
  return out;
}
