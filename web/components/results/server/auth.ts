import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { MemberRole } from "@/lib/types";

export type Db = Awaited<ReturnType<typeof createClient>>;

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const WRITE_ROLES: readonly MemberRole[] = ["admin", "recruiter"];
export const canWrite = (role: MemberRole) => WRITE_ROLES.includes(role);

export function jsonError(status: number, error: string) {
  return Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
}
export function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export type Member = { db: Db; userId: string; companyId: string; role: MemberRole };

/**
 * Signed-in user + their company membership, using the user's own RLS-bound client
 * (never the service role). 401 when signed out, 403 when not in any company.
 */
export async function requireMember(): Promise<Member | Response> {
  const db = await createClient();
  const { data, error } = await db.auth.getClaims();
  const userId = data?.claims?.sub;
  if (error || !userId) return jsonError(401, "Sign in to continue");
  const { data: m } = await db
    .from("members")
    .select("company_id, role")
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!m) return jsonError(403, "Your account is not linked to a company");
  return { db, userId, companyId: m.company_id, role: m.role };
}

/** The caller's role in a specific company (RLS shows only their own memberships). */
export async function roleIn(db: Db, userId: string, companyId: string): Promise<MemberRole | null> {
  const { data } = await db.from("members").select("role").eq("user_id", userId).eq("company_id", companyId).maybeSingle();
  return data?.role ?? null;
}
