import "server-only";
import { createClient } from "@/lib/supabase/server";
import { readRoleProfile } from "@/lib/ai/role-profile";
import { RoleProfilePanel } from "./role-profile-panel";

/**
 * Loads the job's current role profile on the caller's RLS-bound client (other companies' rows are
 * invisible) and renders the editor. Hiring managers get it read-only; the API enforces the same.
 */
export async function RoleProfileSection({ jobId, editable, hasJd }: { jobId: string; editable: boolean; hasJd: boolean }) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("role_profiles")
    .select("version, source, requirements, must_have_checks, quality_anchors, created_at")
    .eq("job_id", jobId)
    .eq("is_current", true)
    .maybeSingle();
  const profile = readRoleProfile(data);
  return (
    <RoleProfilePanel
      jobId={jobId}
      editable={editable}
      hasJd={hasJd}
      initial={profile ? { body: { requirements: profile.requirements, must_have_checks: profile.must_have_checks, quality_anchors: profile.quality_anchors }, version: profile.version, source: profile.source, savedAt: data?.created_at ?? null } : null}
    />
  );
}
