/**
 * Single-call routes for the dashboard (admin / recruiter only).
 *  POST /api/calls/phone        {candidate_id} → "Call now": queues an immediate phone call; the
 *                                dispatcher dials it (safety lock + calling hours + line cap apply).
 *                                No heads-up message: the call is placed right away.
 *  POST /api/calls/web-session  {candidate_id} → mints a Bolna Web Call session for the app agent
 *                                with the brief as user_data; returns Bolna's response unchanged.
 */
import { after } from "next/server";
import { json, jsonError, type DB } from "../ingest/http";
import { createAdminClient } from "../supabase/admin";
import { requireCandidateRole } from "./auth";
import { dispatchEnabled } from "./config";
import { buildUserData, loadCallContext } from "./context";
import { mintWebSession } from "./bolna";
import { kickDispatcher } from "./kick";
import { setCandidateStatus, untyped } from "./lifecycle";

async function body(req: Request): Promise<Record<string, unknown>> {
  const b = await req.json().catch(() => null);
  return b && typeof b === "object" && !Array.isArray(b) ? (b as Record<string, unknown>) : {};
}

async function hasOpenCall(db: DB, candidateId: string) {
  const { data } = await db.from("calls").select("id").eq("candidate_id", candidateId).in("state", ["queued", "dialing", "in_call"]).limit(1);
  return Boolean(data?.length);
}

export async function handlePhoneCall(req: Request, kick: (jobId: string) => void = (id) => after(() => kickDispatcher(id))): Promise<Response> {
  const b = await body(req);
  const auth = await requireCandidateRole(b.candidate_id);
  if (auth instanceof Response) return auth;
  const { supabase: db, candidate } = auth;
  if (await hasOpenCall(db, candidate.id)) return jsonError(409, "This candidate already has a call queued or in progress");

  const { data: call, error } = await untyped(db)
    .from("calls")
    .insert({
      candidate_id: candidate.id,
      job_id: candidate.job_id,
      company_id: candidate.company_id,
      state: "queued",
      due_at: new Date().toISOString(),
      attempt: 1,
      call_kind: "phone",
      heads_up: false,
    })
    .select("id, state, due_at")
    .single();
  if (error || !call) return jsonError(400, "Could not queue the call");
  await setCandidateStatus(db, candidate.id, "queued", ["imported", "ats_filtered", "scored"]);
  kick(candidate.job_id);
  return json({ call, dispatch_enabled: dispatchEnabled() }, 201);
}

export async function handleWebSession(req: Request): Promise<Response> {
  const b = await body(req);
  const auth = await requireCandidateRole(b.candidate_id);
  if (auth instanceof Response) return auth;
  const { supabase: db, candidate } = auth;

  const ctx = await loadCallContext(db, candidate.id);
  if (!ctx) return jsonError(404, "Candidate not found");

  const { data: call, error } = await db
    .from("calls")
    .insert({
      candidate_id: candidate.id,
      job_id: candidate.job_id,
      company_id: candidate.company_id,
      state: "dialing",
      due_at: new Date().toISOString(),
      locked_at: new Date().toISOString(),
      attempt: 1,
      call_kind: "web",
    })
    .select("id")
    .single();
  if (error || !call) return jsonError(400, "Could not start the call");

  // Linking the Bolna run id is a server-side bookkeeping write (service role, scoped to this row).
  const admin = createAdminClient();
  try {
    const userData = await buildUserData(ctx, call.id);
    const session = await mintWebSession(userData);
    await admin.from("calls").update({ bolna_execution_id: session.run_id }).eq("id", call.id);
    await setCandidateStatus(admin, candidate.id, "calling", ["imported", "ats_filtered", "queued", "scored"]);
    return json(session);
  } catch {
    await admin.from("calls").update({ state: "finished", outcome: "failed", termination_reason: "web_session_failed" }).eq("id", call.id);
    return jsonError(502, "Could not start a browser call right now");
  }
}
