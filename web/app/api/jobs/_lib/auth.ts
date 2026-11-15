import "server-only";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import type { MemberRole } from "@/lib/types";

type Supabase = Awaited<ReturnType<typeof createClient>>;

export function jsonError(status: number, error: string) {
  return NextResponse.json({ error }, { status });
}

export const WRITE_ROLES: readonly MemberRole[] = ["admin", "recruiter"];

/** Parse a JSON body; null when it is not valid JSON. */
export async function readJson(req: Request): Promise<unknown | null> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

export function zodMessage(err: z.ZodError) {
  const first = err.issues[0];
  if (!first) return "Invalid request";
  const path = first.path.length ? `${first.path.join(".")}: ` : "";
  return `${path}${first.message}`;
}

type Ok<T> = { ok: true } & T;
type Fail = { ok: false; response: NextResponse };

/** Signed-in user (verified JWT claims) or a 401. */
export async function requireUser(): Promise<Ok<{ supabase: Supabase; userId: string }> | Fail> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (error || !userId) return { ok: false, response: jsonError(401, "Sign in to continue") };
  return { ok: true, supabase, userId };
}

/**
 * Authorise access to one job, server-side:
 *  - 401 signed out
 *  - 404 not a uuid, or not visible (RLS hides other companies' jobs, so "other company" = 404)
 *  - 403 when `write` and the caller's role in that company is not admin/recruiter
 * RLS enforces the same rules again on every query that follows.
 */
export async function authorizeJob(
  jobId: string,
  { write }: { write: boolean },
): Promise<Ok<{ supabase: Supabase; userId: string; job: { id: string; company_id: string }; role: MemberRole }> | Fail> {
  const auth = await requireUser();
  if (!auth.ok) return auth;
  const { supabase, userId } = auth;

  if (!z.uuid().safeParse(jobId).success) return { ok: false, response: jsonError(404, "Job not found") };

  const { data: job, error } = await supabase.from("jobs").select("id, company_id").eq("id", jobId).maybeSingle();
  if (error) return { ok: false, response: jsonError(500, "Could not load the job") };
  if (!job) return { ok: false, response: jsonError(404, "Job not found") };

  const { data: member } = await supabase
    .from("members")
    .select("role")
    .eq("user_id", userId)
    .eq("company_id", job.company_id)
    .maybeSingle();
  if (!member) return { ok: false, response: jsonError(404, "Job not found") };
  if (write && !WRITE_ROLES.includes(member.role)) {
    return { ok: false, response: jsonError(403, "Only admins and recruiters can change this job") };
  }
  return { ok: true, supabase, userId, job, role: member.role };
}
