import "server-only";
/**
 * Delete-on-request (PRD §11). POST /api/candidates/:id/erase — company ADMIN only.
 *
 *  1. signed out -> 401; candidate invisible to the caller (other company / no such id) -> 404;
 *     member but not admin -> 403. All checked with the caller's own RLS-bound client.
 *  2. Stored files (resume folder + any recording kept in our storage) are removed through the
 *     Storage API first. If that fails nothing else is touched, so the admin can simply retry.
 *  3. public.erase_candidate() then hard-deletes calls, scores, actions, messages (when that table
 *     exists), webhook payloads and the candidate row in ONE transaction, re-checks the admin role,
 *     and writes a count-only retention_runs row (no names, phones or candidate ids).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { UUID_RE, json, jsonError, requireMember, roleIn } from "@/components/results/server/auth";
import { createAdminClient } from "@/lib/supabase/admin";

const RESUMES = "resumes";
const Body = z.object({ confirm: z.literal(true) });

/** "bucket/path" -> { bucket, path }; Bolna-hosted https links (and anything odd) -> null. */
export function storageRef(raw: string | null | undefined): { bucket: string; path: string } | null {
  if (!raw) return null;
  const clean = raw.replace(/^\/+/, "");
  if (/^[a-z]+:/i.test(clean)) return null;
  const m = /^([A-Za-z0-9_-]+)\/(.+)$/.exec(clean);
  return m ? { bucket: m[1], path: m[2] } : null;
}

async function removeFiles(companyId: string, candidateId: string, jobIds: string[], resumePath: string | null, recordings: (string | null)[]) {
  const storage = createAdminClient().storage;
  const byBucket = new Map<string, Set<string>>();
  const add = (bucket: string, path: string) => {
    if (!byBucket.has(bucket)) byBucket.set(bucket, new Set());
    byBucket.get(bucket)!.add(path);
  };
  if (resumePath) add(RESUMES, resumePath.replace(/^\/+/, ""));
  for (const jobId of new Set(jobIds)) {
    const folder = `${companyId}/${jobId}/${candidateId}`;
    const { data, error } = await storage.from(RESUMES).list(folder, { limit: 1000 });
    if (error) throw new Error("storage list failed");
    for (const f of data ?? []) if (f.name) add(RESUMES, `${folder}/${f.name}`);
  }
  for (const r of recordings) {
    const ref = storageRef(r);
    if (ref) add(ref.bucket, ref.path);
  }
  let removed = 0;
  for (const [bucket, paths] of byBucket) {
    const { data, error } = await storage.from(bucket).remove([...paths]);
    if (error) throw new Error("storage remove failed");
    removed += data?.length ?? 0;
  }
  return removed;
}

export async function handleErase(req: Request, id: string): Promise<Response> {
  const me = await requireMember();
  if (me instanceof Response) return me;
  if (!UUID_RE.test(id)) return jsonError(404, "Candidate not found");

  const { data: cand } = await me.db.from("candidates").select("id, company_id, job_id, resume_path").eq("id", id).maybeSingle();
  if (!cand) return jsonError(404, "Candidate not found");
  const role = await roleIn(me.db, me.userId, cand.company_id);
  if (!role) return jsonError(404, "Candidate not found");
  if (role !== "admin") return jsonError(403, "Only admins can erase candidate data");

  const body = Body.safeParse(await req.json().catch(() => null));
  if (!body.success) return jsonError(400, "Confirm the erasure to continue");

  const { data: calls, error: callsErr } = await me.db
    .from("calls")
    .select("job_id, recording_url")
    .eq("candidate_id", id)
    .eq("company_id", cand.company_id);
  if (callsErr) return jsonError(500, "Could not erase this candidate");

  let filesDeleted = 0;
  try {
    filesDeleted = await removeFiles(
      cand.company_id,
      cand.id,
      [cand.job_id, ...(calls ?? []).map((c) => c.job_id)],
      cand.resume_path,
      (calls ?? []).map((c) => c.recording_url),
    );
  } catch {
    return jsonError(502, "Stored files could not be deleted. Nothing was erased; try again.");
  }

  const db = me.db as unknown as SupabaseClient;
  const { data: counts, error } = await db.rpc("erase_candidate", { p_candidate_id: id });
  if (error) {
    if (error.code === "P0002") return jsonError(404, "Candidate not found");
    if (error.code === "42501") return jsonError(403, "Only admins can erase candidate data");
    return jsonError(500, "Could not erase this candidate");
  }
  return json({ erased: true, counts: { ...(counts as Record<string, number>), files_deleted: filesDeleted } });
}
