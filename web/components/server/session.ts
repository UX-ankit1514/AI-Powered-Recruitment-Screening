import "server-only";
import { cache } from "react";
import { connection } from "next/server";
import { createClient, getUserClaims } from "@/lib/supabase/server";
import type { MemberRole } from "@/lib/types";

export type Membership = {
  userId: string;
  email: string;
  role: MemberRole;
  companyId: string;
  companyName: string;
};

/**
 * The signed-in user's company membership, deduplicated per request.
 * RLS limits `members` to the caller's own companies; we take the first (one company per user today).
 * Returns null when signed out or not linked to a company.
 */
export const getMembership = cache(async (): Promise<Membership | null> => {
  // Request-time only: auth checks read the clock (token expiry), which must not run in a prerender.
  await connection();
  const claims = await getUserClaims();
  if (!claims?.sub) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from("members")
    .select("role, company_id, company:companies(id, name)")
    .eq("user_id", claims.sub)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  return {
    userId: claims.sub,
    email: String(claims.email ?? ""),
    role: data.role,
    companyId: data.company_id,
    companyName: data.company?.name ?? "",
  };
});

export function canEdit(role: MemberRole | undefined | null) {
  return role === "admin" || role === "recruiter";
}

export const ROLE_LABEL: Record<MemberRole, string> = {
  admin: "Admin",
  recruiter: "Recruiter",
  hiring_manager: "Hiring manager",
};
