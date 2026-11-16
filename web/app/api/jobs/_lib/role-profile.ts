import "server-only";
import type { NextResponse } from "next/server";
import type { RoleProfileBody } from "@/lib/ai/role-profile-schema";
import { jsonError } from "./auth";
import type { createClient } from "@/lib/supabase/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;

export const ROLE_PROFILE_COLUMNS = ["id", "job_id", "version", "requirements", "must_have_checks", "quality_anchors", "source", "is_current", "created_at"] as const;

/** Atomic versioned save through the SECURITY INVOKER RPC (caller's RLS applies). */
export async function saveRoleProfile(
  supabase: Supabase,
  jobId: string,
  body: RoleProfileBody,
  meta: { source: "generated" | "edited"; model_version?: string; prompt_version?: string },
): Promise<{ ok: true; row: Record<string, unknown> } | { ok: false; response: NextResponse }> {
  const { data, error } = await supabase.rpc("save_role_profile_version", {
    p_job_id: jobId,
    p_requirements: body.requirements,
    p_must_have_checks: body.must_have_checks,
    p_quality_anchors: body.quality_anchors,
    p_source: meta.source,
    p_model_version: meta.model_version ?? undefined,
    p_prompt_version: meta.prompt_version ?? undefined,
  });
  if (error) {
    if (error.code === "42501") return { ok: false, response: jsonError(403, "Only admins and recruiters can change this job") };
    if (error.code === "P0002") return { ok: false, response: jsonError(404, "Job not found") };
    if (error.code === "23505") return { ok: false, response: jsonError(409, "Someone saved the role profile at the same time. Reload and try again.") };
    return { ok: false, response: jsonError(500, "Could not save the role profile") };
  }
  const saved = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | undefined;
  if (!saved) return { ok: false, response: jsonError(500, "Could not save the role profile") };
  return { ok: true, row: Object.fromEntries(ROLE_PROFILE_COLUMNS.map((k) => [k, saved[k]])) };
}
