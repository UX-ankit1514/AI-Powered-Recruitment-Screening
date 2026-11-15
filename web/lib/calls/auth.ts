/** Server-side authorization for recruiter-facing call routes. RLS still applies underneath. */
import { UUID, WRITE_ROLES, jsonError, requireSession, type Session } from "../ingest/http";
import type { Database } from "../database.types";

type Role = Database["public"]["Enums"]["member_role"];
export type CandidateRef = { id: string; company_id: string; job_id: string; status: string };

/**
 * Loads the candidate through the caller's RLS client (other companies get 404, never a hint it
 * exists) and requires one of `roles` in the candidate's company.
 */
export async function requireCandidateRole(
  candidateId: unknown,
  roles: Role[] = WRITE_ROLES,
): Promise<(Session & { candidate: CandidateRef; role: Role }) | Response> {
  const s = await requireSession();
  if (s instanceof Response) return s;
  if (typeof candidateId !== "string" || !UUID.test(candidateId)) return jsonError(400, "Send {candidate_id}");
  const { data: candidate } = await s.supabase
    .from("candidates")
    .select("id, company_id, job_id, status")
    .eq("id", candidateId)
    .maybeSingle();
  if (!candidate) return jsonError(404, "Candidate not found");
  const { data: member } = await s.supabase
    .from("members")
    .select("role")
    .eq("user_id", s.userId)
    .eq("company_id", candidate.company_id)
    .maybeSingle();
  if (!member) return jsonError(404, "Candidate not found");
  if (!roles.includes(member.role)) return jsonError(403, "Your role cannot do this");
  return { ...s, candidate, role: member.role };
}
