/**
 * M9: a scoring failure after a completed call is retried (score_status + claim_score_retries),
 * with backoff and at most 3 attempts in all; a retry never stores a second score.
 * Live Supabase; the AI scorer is mocked; nothing is dialled (no Bolna key, no dispatch).
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ACME, dropJobs, service } from "./helpers";

vi.mock("server-only", () => ({}));
vi.mock("../../lib/supabase/admin", async () => {
  const { adminClient } = await import("../../scripts/seed");
  return { createAdminClient: () => adminClient() };
});
vi.mock("../../lib/ai", async (importOriginal) => ({ ...(await importOriginal<typeof import("../../lib/ai")>()), scoreCall: vi.fn(), classifyCall: vi.fn(async () => { throw new Error("offline"); }) }));

import { scoreCall } from "../../lib/ai";
import { processExecution, retryPendingScores, MAX_SCORE_ATTEMPTS } from "../../lib/calls/webhook";
import type { DB as CallsDB } from "../../lib/calls/lifecycle";

const db = service();
const calls = db as unknown as CallsDB;
const scoreMock = vi.mocked(scoreCall);
const jobs: string[] = [];
let jobId = "";

const TRANSCRIPT = "assistant: Hi, am I speaking with Asha?\nuser: Yes, I ran inside sales for two years.\nassistant: Thanks.";
const scoreResult = () => ({
  qualities: { skills: { score: 4, reason: "ok", quotes: [] } },
  must_have_results: [],
  flags: { other_role: null, culture_standout: false, wants_internship: false, resume_mismatch: [], hr_review: null },
  summary: "Good.",
  profile_updates: null,
  short_exit: false,
  conduct_ended: false,
  callback_requested_at: null,
  model_version: "test",
  prompt_version: "test",
});

async function completedCall() {
  const phone = `+1555018${String(Math.floor(Math.random() * 10_000)).padStart(4, "0")}`;
  const cand = await db.from("candidates").insert({ company_id: ACME, job_id: jobId, name: "Asha Test", phone, source: "csv", status: "calling" }).select("id").single();
  if (cand.error) throw cand.error;
  const execId = `m9-${randomUUID()}`;
  const call = await db
    .from("calls")
    .insert({ candidate_id: cand.data.id, job_id: jobId, company_id: ACME, state: "in_call", bolna_execution_id: execId, due_at: new Date().toISOString() })
    .select("id, candidate_id")
    .single();
  if (call.error) throw call.error;
  const exec = {
    id: execId,
    status: "completed",
    termination_reason: "agent_ended_call",
    conversation_duration: 120,
    total_cost: 12,
    transcript: TRANSCRIPT,
    initiated_at: new Date().toISOString(),
    telephony_data: { duration: 125, recording_url: "https://recordings.example/m9.mp3" },
  };
  return { callId: call.data.id as string, candidateId: call.data.candidate_id as string, exec };
}

const getCall = async (id: string) =>
  (await db.from("calls").select("state, outcome, score_status, score_attempts, score_next_at, score_error").eq("id", id).single()).data as {
    state: string;
    outcome: string;
    score_status: string | null;
    score_attempts: number;
    score_next_at: string | null;
    score_error: string | null;
  };
const scoresFor = async (id: string) => (await db.from("scores").select("id").eq("call_id", id)).data ?? [];
const candStatus = async (id: string) => (await db.from("candidates").select("status").eq("id", id).single()).data?.status;
const makeDue = (id: string) => db.from("calls").update({ score_next_at: new Date(Date.now() - 1000).toISOString() }).eq("id", id);

const savedEnv = { BOLNA_API_KEY: process.env.BOLNA_API_KEY, DISPATCH_SECRET: process.env.DISPATCH_SECRET };

beforeAll(async () => {
  delete process.env.BOLNA_API_KEY; // never reach Bolna
  delete process.env.DISPATCH_SECRET; // no dispatcher kick
  const j = await db.from("jobs").insert({ company_id: ACME, title: "M9 score retry job", jd_text: "x" }).select("id").single();
  if (j.error) throw j.error;
  jobId = j.data.id;
  jobs.push(jobId);
  await db.from("rubrics").insert({ job_id: jobId, company_id: ACME, version: 1, weights: { skills: 100 }, is_current: true });
});
afterAll(async () => {
  await dropJobs(jobs);
  for (const [k, v] of Object.entries(savedEnv)) if (v !== undefined) process.env[k] = v;
});
beforeEach(() => {
  scoreMock.mockReset(); // block body: a returned function would be run as a cleanup hook
});

describe("scoring retry after a completed call", () => {
  it("first failure is recorded as failed with a backoff; the retry stores exactly one score", async () => {
    const c = await completedCall();
    scoreMock.mockImplementationOnce(async () => {
      throw new Error("AI gateway 503");
    });
    const r = await processExecution(calls, c.exec, { kick: false });
    expect(r).toMatchObject({ handled: true, scored: false });

    let row = await getCall(c.callId);
    expect(row).toMatchObject({ state: "finished", outcome: "completed", score_status: "failed", score_attempts: 1, score_error: "AI gateway 503" });
    expect(Date.parse(row.score_next_at!)).toBeGreaterThan(Date.now());
    expect(await scoresFor(c.callId)).toHaveLength(0);

    // not due yet -> not claimed
    expect(await retryPendingScores(calls, 3, jobId)).toBe(0);

    await makeDue(c.callId);
    scoreMock.mockResolvedValueOnce(scoreResult() as never);
    expect(await retryPendingScores(calls, 3, jobId)).toBe(1);
    row = await getCall(c.callId);
    expect(row).toMatchObject({ score_status: "done", score_attempts: 2, score_error: null });
    expect(await scoresFor(c.callId)).toHaveLength(1);
    expect(await candStatus(c.candidateId)).toBe("scored");

    // done calls are never claimed again
    await makeDue(c.callId);
    expect(await retryPendingScores(calls, 3, jobId)).toBe(0);
    expect(scoreMock).toHaveBeenCalledTimes(2);
  });

  it(`gives up after ${MAX_SCORE_ATTEMPTS} attempts and frees the candidate for a re-call`, async () => {
    const c = await completedCall();
    scoreMock.mockImplementation(async () => {
      throw new Error("still down");
    });
    await processExecution(calls, c.exec, { kick: false });
    for (let i = 0; i < 5; i++) {
      await makeDue(c.callId);
      await retryPendingScores(calls, 3, jobId);
    }
    const row = await getCall(c.callId);
    expect(row).toMatchObject({ score_status: "gave_up", score_attempts: MAX_SCORE_ATTEMPTS });
    expect(scoreMock).toHaveBeenCalledTimes(MAX_SCORE_ATTEMPTS);
    expect(await scoresFor(c.callId)).toHaveLength(0);
    expect(await candStatus(c.candidateId)).toBe("imported");
  });

  it("a worker that died mid-scoring is picked up after 10 minutes", async () => {
    const c = await completedCall();
    await db.from("calls").update({ state: "finished", outcome: "completed", transcript: TRANSCRIPT, score_status: "scoring", score_attempts: 1, score_next_at: new Date(Date.now() - 11 * 60_000).toISOString() }).eq("id", c.callId);
    scoreMock.mockResolvedValueOnce(scoreResult() as never);
    expect(await retryPendingScores(calls, 3, jobId)).toBe(1);
    expect((await getCall(c.callId)).score_status).toBe("done");
  });

  it("a retry after a score was already stored does not store a second one", async () => {
    const c = await completedCall();
    scoreMock.mockResolvedValueOnce(scoreResult() as never);
    await processExecution(calls, c.exec, { kick: false });
    expect(await scoresFor(c.callId)).toHaveLength(1);
    await db.from("calls").update({ score_status: "failed", score_next_at: new Date(Date.now() - 1000).toISOString() }).eq("id", c.callId);
    expect(await retryPendingScores(calls, 3, jobId)).toBe(1);
    expect(await scoresFor(c.callId)).toHaveLength(1);
    expect(scoreMock).toHaveBeenCalledTimes(1);
  });

  it("clients cannot claim retries or write scores", async () => {
    const { anonClient, castOfUsers, cleanupCast } = await import("./helpers");
    const { error: anonErr } = await anonClient().rpc("claim_score_retries", { p_limit: 1 });
    expect(anonErr).toBeTruthy();
    const cast = await castOfUsers();
    try {
      const { error: adminErr } = await cast.admin.rpc("claim_score_retries", { p_limit: 1 });
      expect(adminErr).toBeTruthy();
      const c = await completedCall();
      const { error: insErr } = await cast.admin.from("scores").insert({
        call_id: c.callId,
        candidate_id: c.candidateId,
        company_id: ACME,
        rubric_version: 1,
        qualities: {},
        must_have_results: [],
        flags: {},
        summary: "forged",
      });
      expect(insErr).toBeTruthy();
      expect(await scoresFor(c.callId)).toHaveLength(0);
    } finally {
      await cleanupCast(cast);
    }
  });
});
