import { applyAtsFilter } from "./ats";
import { WRITE_ROLES, json, jsonError, requireJobRole } from "./http";

/** POST /api/jobs/:id/ats/apply (admin/recruiter): re-apply the job's ATS setting. */
export async function handleAtsApply(jobId: string): Promise<Response> {
  const auth = await requireJobRole(jobId, WRITE_ROLES);
  if (auth instanceof Response) return auth;
  try {
    return json(await applyAtsFilter(auth.job.id, auth.supabase));
  } catch {
    return jsonError(400, "Could not apply the ATS filter");
  }
}
