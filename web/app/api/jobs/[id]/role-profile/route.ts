import { NextResponse } from "next/server";
import { RoleProfileBodySchema } from "@/lib/ai/role-profile-schema";
import { authorizeJob, jsonError, readJson, zodMessage } from "../../_lib/auth";
import { saveRoleProfile } from "../../_lib/role-profile";

/**
 * PUT /api/jobs/:id/role-profile — HR's reviewed/edited role profile, saved as a NEW version and
 * made current (admin/recruiter only; RLS + public.save_role_profile_version enforce it again).
 * Existing scores keep the version they were scored with; the next call and evaluation use this one.
 */
export async function PUT(req: Request, ctx: RouteContext<"/api/jobs/[id]/role-profile">) {
  const { id } = await ctx.params;
  const auth = await authorizeJob(id, { write: true });
  if (!auth.ok) return auth.response;

  const body = await readJson(req);
  if (body === null) return jsonError(400, "Send a JSON body");
  const parsed = RoleProfileBodySchema.safeParse(body);
  if (!parsed.success) return jsonError(400, zodMessage(parsed.error));

  const saved = await saveRoleProfile(auth.supabase, auth.job.id, parsed.data, { source: "edited" });
  if (!saved.ok) return saved.response;
  return NextResponse.json({ role_profile: saved.row });
}
