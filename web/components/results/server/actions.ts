import "server-only";
/**
 * POST /api/candidates/:id/actions — the audit log for decisions on a candidate.
 *  - note: any member of the candidate's company (hiring managers included)
 *  - shortlist / reject / override / move_to_job: admin or recruiter only
 * Authorisation is checked here AND enforced again by RLS on every write.
 * Overrides are stored only as actions, so a later re-score never erases them.
 * Rejecting cancels the candidate's waiting calls (booked callbacks included: a human decided);
 * the reject action records how many were cancelled.
 */
import { z } from "zod";
import type { Json } from "@/lib/database.types";
import { PICKS } from "@/components/results/model";
import { UUID_RE, canWrite, json, jsonError, roleIn, type Db } from "./auth";
import { createClient } from "@/lib/supabase/server";
import { cancelQueuedCalls } from "@/lib/calls/cancel";

const Body = z.discriminatedUnion("type", [
  z.object({ type: z.literal("note"), note: z.string().trim().min(1).max(2000) }),
  z.object({
    type: z.literal("shortlist"),
    new_value: z.object({ undo: z.boolean().optional() }).optional(),
    note: z.string().trim().max(2000).optional(),
  }),
  z.object({
    type: z.literal("reject"),
    new_value: z.object({ undo: z.boolean().optional() }).optional(),
    note: z.string().trim().max(2000).optional(),
  }),
  z.object({
    type: z.literal("override"),
    new_value: z.object({ pick: z.enum(PICKS).nullable() }),
    note: z.string().trim().max(2000).optional(),
  }),
  z.object({
    type: z.literal("move_to_job"),
    target_job_id: z.string().regex(UUID_RE),
    note: z.string().trim().max(2000).optional(),
  }),
]);

type Cand = {
  id: string;
  company_id: string;
  job_id: string;
  name: string;
  phone: string;
  email: string | null;
  source: string;
  status: string;
  profile: Json | null;
  resume_path: string | null;
  resume_only_score: number | null;
  consent_at: string | null;
  consent_source: string | null;
};

export async function handleCandidateAction(req: Request, candidateId: string): Promise<Response> {
  let raw: unknown = null;
  try {
    raw = await req.json();
  } catch {
    raw = null;
  }
  const db = await createClient();
  const { data: claims, error: authErr } = await db.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (authErr || !userId) return jsonError(401, "Sign in to continue");
  if (!UUID_RE.test(candidateId)) return jsonError(404, "Candidate not found");

  const { data: cand } = await db
    .from("candidates")
    .select("id, company_id, job_id, name, phone, email, source, status, profile, resume_path, resume_only_score, consent_at, consent_source")
    .eq("id", candidateId)
    .maybeSingle();
  if (!cand) return jsonError(404, "Candidate not found");
  const role = await roleIn(db, userId, cand.company_id);
  if (!role) return jsonError(404, "Candidate not found");

  const parsed = Body.safeParse(raw);
  if (!parsed.success) return jsonError(400, "Send {type, note?, new_value?, target_job_id?}");
  const body = parsed.data;

  if (body.type !== "note" && !canWrite(role)) {
    return jsonError(403, "Only admins and recruiters can shortlist, reject or change a pick. You can add a note.");
  }

  const base = { candidate_id: cand.id, company_id: cand.company_id, user_id: userId };

  if (body.type === "note") {
    return insertAction(db, { ...base, type: "note", note: body.note });
  }

  if (body.type === "shortlist" || body.type === "reject") {
    const undo = body.new_value?.undo === true;
    let next: string = body.type === "shortlist" ? "shortlisted" : "rejected";
    if (undo) {
      const { count } = await db.from("scores").select("id", { count: "exact", head: true }).eq("candidate_id", cand.id);
      next = count ? "scored" : "imported";
    }
    const { error } = await db.from("candidates").update({ status: next }).eq("id", cand.id);
    if (error) return jsonError(error.code === "42501" ? 403 : 400, "Could not update the candidate");
    let cancelled = 0;
    if (body.type === "reject" && !undo) {
      cancelled = (await cancelQueuedCalls(db, { candidateId: cand.id }, { includeCallbacks: true })).cancelled;
    }
    const auto = cancelled ? `${cancelled} waiting call${cancelled === 1 ? "" : "s"} cancelled` : null;
    return insertAction(db, {
      ...base,
      type: body.type,
      old_value: { status: cand.status },
      new_value: { status: next, ...(undo ? { undo: true } : {}), ...(cancelled ? { cancelled_calls: cancelled } : {}) },
      note: [body.note, auto].filter(Boolean).join(" · ") || null,
    });
  }

  if (body.type === "override") {
    const { data: prev } = await db
      .from("actions")
      .select("new_value")
      .eq("candidate_id", cand.id)
      .eq("type", "override")
      .order("at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const prevPick = (prev?.new_value as { pick?: unknown } | null)?.pick ?? null;
    return insertAction(db, {
      ...base,
      type: "override",
      old_value: { pick: typeof prevPick === "string" ? prevPick : null },
      new_value: { pick: body.new_value.pick },
      note: body.note ?? null,
    });
  }

  // move_to_job: copy the person into another open job of the same company, shortlisted there.
  if (body.target_job_id === cand.job_id) return jsonError(400, "They are already in this job");
  const { data: target } = await db
    .from("jobs")
    .select("id, title, company_id, status")
    .eq("id", body.target_job_id)
    .maybeSingle();
  if (!target || target.company_id !== cand.company_id) return jsonError(404, "Job not found");
  if (target.status !== "open") return jsonError(409, "That job is closed");

  const targetId = await upsertIntoJob(db, cand as Cand, target.id);
  if (targetId instanceof Response) return targetId;

  const { data: fromJob } = await db.from("jobs").select("title").eq("id", cand.job_id).maybeSingle();
  await db.from("actions").insert({
    candidate_id: targetId,
    company_id: cand.company_id,
    user_id: userId,
    type: "shortlist",
    new_value: { status: "shortlisted", from_candidate_id: cand.id, from_job_id: cand.job_id },
    note: `Moved from ${fromJob?.title ?? "another job"}`,
  });
  return insertAction(db, {
    ...base,
    type: "move_to_job",
    old_value: { job_id: cand.job_id },
    new_value: { target_job_id: target.id, target_candidate_id: targetId },
    note: body.note ?? null,
  });
}

async function upsertIntoJob(db: Db, cand: Cand, jobId: string): Promise<string | Response> {
  const { data: existing } = await db.from("candidates").select("id").eq("job_id", jobId).eq("phone", cand.phone).maybeSingle();
  if (existing) {
    const { error } = await db.from("candidates").update({ status: "shortlisted" }).eq("id", existing.id);
    if (error) return jsonError(error.code === "42501" ? 403 : 400, "Could not shortlist them in that job");
    return existing.id;
  }
  const { data, error } = await db
    .from("candidates")
    .insert({
      company_id: cand.company_id,
      job_id: jobId,
      name: cand.name,
      phone: cand.phone,
      email: cand.email,
      source: cand.source,
      profile: cand.profile,
      resume_path: cand.resume_path,
      resume_only_score: cand.resume_only_score,
      consent_at: cand.consent_at,
      consent_source: cand.consent_source,
      status: "shortlisted",
    })
    .select("id")
    .single();
  if (error || !data) return jsonError(error?.code === "42501" ? 403 : 400, "Could not add them to that job");
  return data.id;
}

async function insertAction(
  db: Db,
  row: {
    candidate_id: string;
    company_id: string;
    user_id: string;
    type: "note" | "shortlist" | "reject" | "override" | "move_to_job";
    note?: string | null;
    old_value?: Json;
    new_value?: Json;
  },
): Promise<Response> {
  const { data, error } = await db.from("actions").insert(row).select("id, type, note, old_value, new_value, at").single();
  if (error || !data) return jsonError(error?.code === "42501" ? 403 : 400, "Could not save that");
  return json({ action: data }, 201);
}
