import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../database.types";
import { createClient } from "../supabase/server";

export type DB = SupabaseClient<Database>;
type Role = Database["public"]["Enums"]["member_role"];

export const WRITE_ROLES: Role[] = ["admin", "recruiter"];
export const ANY_ROLE: Role[] = ["admin", "recruiter", "hiring_manager"];

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function jsonError(status: number, error: string) {
  return Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
}

export function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export type Session = { supabase: DB; userId: string };

/** Signed-in user's RLS-bound client, or a 401 response. */
export async function requireSession(): Promise<Session | Response> {
  const supabase = (await createClient()) as unknown as DB;
  const { data, error } = await supabase.auth.getClaims();
  const sub = data?.claims?.sub;
  if (error || !sub) return jsonError(401, "Sign in required");
  return { supabase, userId: sub };
}

export type JobRow = Pick<
  Database["public"]["Tables"]["jobs"]["Row"],
  "id" | "company_id" | "title" | "jd_text" | "status" | "ats_mode" | "ats_top_pct" | "ats_rescue" | "screening_started_at"
>;
const JOB_COLS = "id, company_id, title, jd_text, status, ats_mode, ats_top_pct, ats_rescue, screening_started_at";

/**
 * Loads the job through RLS (non-members get 404, never a hint the job exists)
 * and checks the caller's role in the job's company server-side.
 */
export async function requireJobRole(
  jobId: string,
  roles: Role[],
): Promise<(Session & { job: JobRow; role: Role }) | Response> {
  const s = await requireSession();
  if (s instanceof Response) return s;
  if (!UUID.test(jobId)) return jsonError(404, "Job not found");

  const { data: job } = await s.supabase.from("jobs").select(JOB_COLS).eq("id", jobId).maybeSingle();
  if (!job) return jsonError(404, "Job not found");

  const { data: member } = await s.supabase
    .from("members")
    .select("role")
    .eq("user_id", s.userId)
    .eq("company_id", job.company_id)
    .maybeSingle();
  if (!member) return jsonError(404, "Job not found");
  if (!roles.includes(member.role)) return jsonError(403, "Your role cannot do this");
  return { ...s, job: job as JobRow, role: member.role };
}
