/**
 * Webhook ↔ evaluation wiring (execution review #5, #8, #9 + language_mix), live Supabase.
 * The model passes are mocked; nothing is dialled (no Bolna key, dispatch disabled).
 *  #5  voicemail / wrong person are not scored and the call is retried
 *  #8  a delivery whose processing failed stays unprocessed and the sweep reprocesses it
 *  #9  a callback request after a full scored call does not book another call
 *  new scores store requirement_scores / coverage / agreement / jd_fit / confidence / language_mix
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ACME, dropJobs, service } from "../security/helpers";

const h = vi.hoisted(() => ({ classify: null as unknown, score: null as unknown }));
vi.mock("server-only", () => ({}));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => undefined }));
vi.mock("../../lib/supabase/admin", async () => {
  const { adminClient } = await import("../../scripts/seed");
  return { createAdminClient: () => adminClient() };
});
vi.mock("../../lib/ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/ai")>()),
  classifyCall: vi.fn(async () => {
    if (h.classify instanceof Error) throw h.classify;
    return h.classify;
  }),
  scoreCall: vi.fn(async () => {
    if (h.score instanceof Error) throw h.score;
    return h.score;
  }),
}));

import { processExecution, reprocessUnprocessedEvents, handleBolnaWebhook } from "../../lib/calls/webhook";
import type { DB as CallsDB } from "../../lib/calls/lifecycle";

const db = service();
const calls = db as unknown as CallsDB;
const jobs: string[] = [];
let jobId = "";

const LONG = Array.from({ length: 7 }, (_, i) => `assistant: Question ${i + 1}?\nuser: I sold software to clinics by phone for two years and I usually beat my monthly target by a good margin, ${i}.`).join("\n");

const conversation = (over: Record<string, unknown> = {}) => ({
  cls: "conversation",
  reason: "",
  shortExit: false,
  conductEnded: false,
  gaming: false,
  callbackAt: null,
  usedModel: true,
  model: "m",
  ...over,
});

const scored = (over: Record<string, unknown> = {}) => ({
  qualities: { skills: { score: 4, reason: "ok", quotes: [] } },
  must_have_results: [],
  flags: { other_role: null, culture_standout: false, wants_internship: false, resume_mismatch: [], hr_review: null },
  summary: "Good.",
  profile_updates: null,
  short_exit: false,
  conduct_ended: false,
  callback_requested_at: null,
  model_version: "test",
  prompt_version: "eval-test",
  call_class: "conversation",
  requirement_scores: { r1: { text: "Phone sales", importance: "must", quality: "experience", score: 4, pass_scores: [4, 4], justification: "x", quotes: [], status: "met" } },
  coverage: { r1: "asked_answered", skills: "asked_answered" },
  agreement: { passes: 2, max_diff: 0, agreement_rate: 1, disagreements: [] },
  jd_fit: { fit_pct: 75, requirements: [], strengths: [], gaps: [], hidden_fits: [], rationale: "r", not_covered: [] },
  confidence: 0.8,
  needs_review: false,
  language_mix: "english",
  role_profile_version: 0,
  ...over,
});

async function liveCall(opts: { transcript?: string; duration?: number } = {}) {
  const phone = `+1555017${String(Math.floor(Math.random() * 10_000)).padStart(4, "0")}`;
  const cand = await db.from("candidates").insert({ company_id: ACME, job_id: jobId, name: "Eval Test", phone, source: "csv", status: "calling" }).select("id").single();
  if (cand.error) throw cand.error;
  const execId = `ev-${randomUUID()}`;
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
    conversation_duration: opts.duration ?? 420,
    total_cost: 30,
    transcript: opts.transcript ?? LONG,
    initiated_at: new Date().toISOString(),
    telephony_data: { duration: (opts.duration ?? 420) + 5, recording_url: null },
  };
  return { callId: call.data.id as string, candidateId: call.data.candidate_id as string, exec };
}

const callsOf = async (candidateId: string) =>
  ((await db.from("calls").select("id, state, outcome, attempt, scheduled, callback_at").eq("candidate_id", candidateId).order("created_at")).data ?? []) as {
    id: string;
    state: string;
    outcome: string | null;
    attempt: number;
    scheduled: boolean;
    callback_at: string | null;
  }[];
const scoresFor = async (callId: string) => (await db.from("scores").select("*").eq("call_id", callId)).data ?? [];

const savedEnv = { BOLNA_API_KEY: process.env.BOLNA_API_KEY, DISPATCH_ENABLED: process.env.DISPATCH_ENABLED, BOLNA_WEBHOOK_SECRET: process.env.BOLNA_WEBHOOK_SECRET };

beforeAll(async () => {
  delete process.env.BOLNA_API_KEY;
  process.env.DISPATCH_ENABLED = "false";
  process.env.BOLNA_WEBHOOK_SECRET = "ev-test-secret";
  const job = await db.from("jobs").insert({ company_id: ACME, title: "Eval webhook job", jd_text: "Sales" }).select("id").single();
  if (job.error) throw job.error;
  jobId = job.data.id as string;
  jobs.push(jobId);
  await db.from("rubrics").insert({ job_id: jobId, company_id: ACME, version: 1, weights: { skills: 50, experience: 50 }, is_current: true });
});

afterAll(async () => {
  await dropJobs(jobs);
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

beforeEach(() => {
  h.classify = conversation();
  h.score = scored();
});

describe("#5 voicemail / wrong person are not scored and are retried", () => {
  it("voicemail heard on a 'completed' call → outcome voicemail, no score, a retry is queued", async () => {
    h.classify = conversation({ cls: "voicemail", reason: "voicemail greeting" });
    const { callId, candidateId, exec } = await liveCall();
    const r = await processExecution(calls, exec, { kick: false });
    expect(r.outcome).toBe("voicemail");
    expect(await scoresFor(callId)).toEqual([]);
    const list = await callsOf(candidateId);
    expect(list[0]).toMatchObject({ state: "finished", outcome: "voicemail" });
    expect(list[1]).toMatchObject({ state: "queued", attempt: 2 });
  });

  it("wrong person → outcome wrong_person, no score, retried", async () => {
    h.classify = conversation({ cls: "wrong_person", reason: "mother answered" });
    const { callId, candidateId, exec } = await liveCall();
    await processExecution(calls, exec, { kick: false });
    expect(await scoresFor(callId)).toEqual([]);
    const list = await callsOf(candidateId);
    expect(list[0].outcome).toBe("wrong_person");
    expect(list).toHaveLength(2);
  });

  it("gateway down: an obvious voicemail is still caught by the heuristics", async () => {
    h.classify = new Error("402");
    const { callId, candidateId, exec } = await liveCall({ transcript: "assistant: Hi, is this Asha?\nuser: The person you are calling is not available, please leave a message after the tone." });
    await processExecution(calls, exec, { kick: false });
    expect(await scoresFor(callId)).toEqual([]);
    expect((await callsOf(candidateId))[0].outcome).toBe("voicemail");
  });

  it("scorer finds a non-conversation late (classification unavailable earlier) → no score stored", async () => {
    h.classify = new Error("402");
    h.score = scored({ call_class: "no_speech", qualities: {} });
    const { callId, exec } = await liveCall();
    await processExecution(calls, exec, { kick: false });
    expect(await scoresFor(callId)).toEqual([]);
    const { data } = await db.from("calls").select("outcome, score_status").eq("id", callId).single();
    expect(data).toMatchObject({ outcome: "no_answer", score_status: "done" });
  });
});

describe("new score columns", () => {
  it("a real conversation stores multi-pass fields and language_mix alongside the legacy columns", async () => {
    const { callId, exec } = await liveCall();
    const r = await processExecution(calls, exec, { kick: false });
    expect(r.scored).toBe(true);
    const [s] = await scoresFor(callId);
    expect(s).toMatchObject({ call_class: "conversation", confidence: 0.8, needs_review: false, language_mix: "english" });
    expect(s.requirement_scores).toHaveProperty("r1");
    expect(s.jd_fit).toMatchObject({ fit_pct: 75 });
    expect(s.qualities).toHaveProperty("skills");
  });
});

describe("#9 callback requests", () => {
  it("after a full scored call: NOT booked", async () => {
    h.score = scored({ callback_requested_at: new Date(Date.now() + 86_400_000).toISOString() });
    const { candidateId, exec } = await liveCall({ duration: 480 });
    const r = await processExecution(calls, exec, { kick: false });
    expect(r.rescheduled).toBe(false);
    const list = await callsOf(candidateId);
    expect(list).toHaveLength(1);
    expect(list[0].outcome).toBe("completed");
  });

  it("from a short, cut-off call: booked", async () => {
    h.score = scored({ callback_requested_at: new Date(Date.now() + 86_400_000).toISOString() });
    const { candidateId, exec } = await liveCall({ duration: 90 });
    const r = await processExecution(calls, exec, { kick: false });
    expect(r.rescheduled).toBe(true);
    const list = await callsOf(candidateId);
    expect(list).toHaveLength(2);
    expect(list[1]).toMatchObject({ scheduled: true, state: "queued" });
  });
});

describe("#8 webhook processing failures are not lost", () => {
  it("a delivery whose processing failed stays unprocessed; the sweep reprocesses it", async () => {
    const { callId, exec } = await liveCall();
    // Simulate a crash mid-processing: store the event as the webhook would, unprocessed and old.
    const ins = await db
      .from("webhook_events")
      .insert({ bolna_execution_id: exec.id, status: "completed", payload: exec, received_at: new Date(Date.now() - 10 * 60_000).toISOString() } as never)
      .select("id")
      .single();
    if (ins.error) throw ins.error;
    const n = await reprocessUnprocessedEvents(calls, 50);
    expect(n).toBeGreaterThanOrEqual(1);
    const { data: ev } = await db.from("webhook_events").select("processed_at, process_attempts").eq("id", ins.data.id).single();
    expect((ev as { processed_at: string | null }).processed_at).not.toBeNull();
    expect(await scoresFor(callId)).toHaveLength(1);
  });

  it("a duplicate delivery of a stale unprocessed event is processed instead of ignored", async () => {
    const { callId, exec } = await liveCall();
    await db
      .from("webhook_events")
      .insert({ bolna_execution_id: exec.id, status: "completed", payload: exec, received_at: new Date(Date.now() - 5 * 60_000).toISOString() } as never);
    const tasks: (() => Promise<unknown>)[] = [];
    const req = new Request(`http://localhost/api/webhooks/bolna?secret=ev-test-secret`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "13.203.39.153" },
      body: JSON.stringify(exec),
    });
    const res = await handleBolnaWebhook(req, (t) => tasks.push(t));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    for (const t of tasks) await t();
    expect(await scoresFor(callId)).toHaveLength(1);
    const { data: ev } = await db.from("webhook_events").select("processed_at").eq("bolna_execution_id", exec.id).single();
    expect((ev as { processed_at: string | null }).processed_at).not.toBeNull();
  });

  it("a fresh duplicate (first delivery still in flight) is acknowledged and ignored", async () => {
    const { exec } = await liveCall();
    await db.from("webhook_events").insert({ bolna_execution_id: exec.id, status: "completed", payload: exec } as never);
    const tasks: (() => Promise<unknown>)[] = [];
    const req = new Request(`http://localhost/api/webhooks/bolna?secret=ev-test-secret`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "13.203.39.153" },
      body: JSON.stringify(exec),
    });
    const res = await handleBolnaWebhook(req, (t) => tasks.push(t));
    expect(await res.json()).toEqual({ ok: true, duplicate: true });
    expect(tasks).toHaveLength(0);
  });
});
