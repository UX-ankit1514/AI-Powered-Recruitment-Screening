/**
 * Execution-review fixes (docs/execution-review.md) against the LIVE Supabase project, real RLS.
 *
 *  - recruiter-role tests for import (with resume text), batches, single calls, web session, close job
 *  - account-wide line cap is per company; a Bolna capacity refusal never uses up an attempt
 *  - browser calls never turn into phone retries; Stop blocks retries and keeps booked callbacks
 *  - closing a job / rejecting a candidate cancels waiting calls
 *  - heads-up timing ("call now" skips it; batch calls wait 2 min after it)
 *  - reschedule refuses non-Bolna source IPs; call lines are admin-only (route + database)
 *
 * Safety: Bolna is never reached (fetch is mocked); test phones are +1 555 01xx except fake +91
 * numbers used only behind the mock. Dispatcher tests run in throwaway companies of their own.
 */
import { randomInt, randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ACME, castOfUsers, cleanupCast, jsonReq, service, type Cast, type DB } from "../security/helpers";

const h = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("server-only", () => ({}));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => undefined }));
vi.mock("../../lib/supabase/server", () => ({ createClient: async () => h.client, getUserClaims: async () => null }));
vi.mock("../../lib/supabase/admin", async () => {
  const { adminClient } = await import("../../scripts/seed");
  return { createAdminClient: () => adminClient() };
});
vi.mock("../../lib/ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/ai")>()),
  scoreCall: vi.fn(async () => {
    throw new Error("not used");
  }),
  writeCallBrief: vi.fn(async (_p: unknown, _r: unknown, job: { title: string }, company: { name: string }, opts: { callId?: string }) => ({
    call_id: opts.callId,
    first_name: "Test",
    role: job.title,
    company: company.name,
    resume_note: "",
    resume_q1: "",
    resume_q2: "",
    must_haves: "",
    jd_summary: "",
    faq: "",
    culture_values: "",
    traits: "",
    other_interest_prompt: "",
  })),
}));

import { handleImport } from "../../lib/ingest/import";
import { __setResumeReader } from "../../lib/ingest/resume";
import { handleBatchProgress, handleCreateBatch, summariseBatchCalls } from "../../lib/ingest/batches";
import { handlePhoneCall, handleWebSession } from "../../lib/calls/single";
import { handleBolnaWebhook } from "../../lib/calls/webhook";
import { handleReschedule } from "../../lib/calls/reschedule";
import { recordTick, runDispatch } from "../../lib/calls/dispatch";
import { readSchedulerHealth } from "../../lib/calls/lines";
import { sendHeadsUp } from "../../lib/messaging/heads-up";
import { matchResumes } from "../../components/calls/resume-match";
import * as cancelRoute from "../../app/api/batches/[id]/cancel/route";
import * as closeRoute from "../../app/api/jobs/[id]/close/route";
import * as linesRoute from "../../app/api/settings/lines/route";
import * as actionsRoute from "../../app/api/candidates/[id]/actions/route";
import * as jobRoute from "../../app/api/jobs/[id]/route";

const ALL_HOURS = { start: "00:00", end: "24:00", days: [0, 1, 2, 3, 4, 5, 6] };
const WH_SECRET = `test-wh-${randomUUID()}`;
const ENV_KEYS = ["DISPATCH_ENABLED", "BOLNA_WEBHOOK_SECRET", "DISPATCH_SECRET", "BOLNA_API_KEY", "APP_BASE_URL", "PICK_TIME_SECRET", "MESSAGING_PROVIDER", "BOLNA_IP_ALLOWLIST", "BOLNA_IP_CHECK"];
const saved: Record<string, string | undefined> = {};

// ---- fetch interception ----
const realFetch = globalThis.fetch;
let bolnaReply: (url: string) => Response = () => new Response("{}", { status: 500 });
const bolnaRequests: string[] = [];
const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.startsWith("https://api.bolna.ai")) {
    bolnaRequests.push(url);
    return bolnaReply(url);
  }
  if (url.startsWith("http://localhost:3999")) return new Response("{}", { status: 200 });
  return realFetch(input, init);
});

let cast: Cast;
const companies: string[] = [];
const jobs: string[] = [];
const execIds: string[] = [];
const svc = service();
const as = (c: DB | null) => {
  h.client = c;
};
const noKick = vi.fn();
const phone = () => `+1555018${String(randomInt(0, 9999)).padStart(4, "0")}`;
const execId = () => {
  const id = `test-xf-${randomUUID()}`;
  execIds.push(id);
  return id;
};
const params = (p: Record<string, string>) => ({ params: Promise.resolve(p) }) as never;

async function makeCompany(lines: number | null = 2) {
  const { data, error } = await svc.from("companies").insert({ name: `XF test co ${randomInt(0, 99999)}`, concurrency_limit: lines }).select("id").single();
  if (error) throw error;
  companies.push(data.id);
  return data.id as string;
}
async function makeJob(company: string = ACME, title = "XF test job") {
  const { data, error } = await svc.from("jobs").insert({ company_id: company, title, jd_text: "Sell.", calling_hours: ALL_HOURS }).select("id, company_id").single();
  if (error) throw error;
  jobs.push(data.id);
  return data as { id: string; company_id: string };
}
async function makeCandidate(job: { id: string; company_id: string }, p = phone(), status = "imported") {
  const { data, error } = await svc.from("candidates").insert({ company_id: job.company_id, job_id: job.id, name: "Asha Test", phone: p, source: "csv", status }).select("id").single();
  if (error) throw error;
  return data.id as string;
}
async function makeBatch(job: { id: string; company_id: string }, status = "running") {
  const { data, error } = await svc.from("batches").insert({ company_id: job.company_id, job_id: job.id, total: 3, status }).select("id").single();
  if (error) throw error;
  return data.id as string;
}
async function makeCall(job: { id: string; company_id: string }, patch: Record<string, unknown> = {}) {
  const candidate_id = (patch.candidate_id as string) ?? (await makeCandidate(job));
  const { data, error } = await svc
    .from("calls")
    .insert({ candidate_id, job_id: job.id, company_id: job.company_id, state: "queued", due_at: new Date().toISOString(), ...patch })
    .select("*")
    .single();
  if (error) throw error;
  return data as Record<string, unknown> & { id: string; candidate_id: string };
}
const callsOf = async (candidateId: string) =>
  ((await svc.from("calls").select("*").eq("candidate_id", candidateId).order("created_at")).data ?? []) as Record<string, unknown>[];

async function webhook(payload: unknown, ip?: string) {
  const tasks: Promise<unknown>[] = [];
  const res = await handleBolnaWebhook(
    new Request(`http://localhost/api/webhooks/bolna?secret=${encodeURIComponent(WH_SECRET)}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(ip ? { "x-forwarded-for": ip } : {}) },
      body: JSON.stringify(payload),
    }),
    (t) => tasks.push(t()),
  );
  await Promise.all(tasks);
  return res;
}

beforeAll(async () => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  delete process.env.DISPATCH_ENABLED;
  delete process.env.MESSAGING_PROVIDER;
  delete process.env.BOLNA_IP_ALLOWLIST;
  delete process.env.BOLNA_IP_CHECK;
  process.env.BOLNA_WEBHOOK_SECRET = WH_SECRET;
  process.env.DISPATCH_SECRET = `test-d-${randomUUID()}`;
  process.env.BOLNA_API_KEY = "test-key-not-real";
  process.env.APP_BASE_URL = "http://localhost:3999";
  process.env.PICK_TIME_SECRET = `test-${randomUUID()}-${randomUUID()}`;
  vi.stubGlobal("fetch", fetchMock);
  cast = await castOfUsers();
});

afterAll(async () => {
  vi.unstubAllGlobals();
  __setResumeReader(undefined);
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  if (execIds.length) await svc.from("webhook_events").delete().in("bolna_execution_id", execIds);
  if (jobs.length) await svc.from("jobs").delete().in("id", jobs);
  if (companies.length) await svc.from("companies").delete().in("id", companies);
  await cleanupCast(cast);
});

beforeEach(() => {
  delete process.env.DISPATCH_ENABLED;
  bolnaRequests.length = 0;
  noKick.mockReset();
});

// ===========================================================================
describe("recruiter role: import, batches, single calls, web session", () => {
  let job: { id: string; company_id: string };
  beforeAll(async () => {
    job = await makeJob();
  });

  it("unauthenticated is refused everywhere (401)", async () => {
    as(cast.anon);
    expect((await handleImport(jsonReq("POST", { rows: [{ name: "A", phone: phone() }], consent_confirmed: true }), job.id)).status).toBe(401);
    expect((await handleCreateBatch(jsonReq("POST", { job_id: job.id }), noKick)).status).toBe(401);
    expect((await handlePhoneCall(jsonReq("POST", { candidate_id: randomUUID() }), noKick)).status).toBe(401);
    expect((await handleWebSession(jsonReq("POST", { candidate_id: randomUUID() }))).status).toBe(401);
    expect((await closeRoute.POST(jsonReq("POST", {}), params({ id: job.id }))).status).toBe(401);
    expect((await linesRoute.PUT(jsonReq("PUT", { lines: 4 }))).status).toBe(401);
  });

  it("recruiter imports with resume text: the resume reader runs and the candidate is enriched", async () => {
    const seen: string[] = [];
    __setResumeReader(async (text: unknown) => {
      seen.push(String(text));
      return { profile: { skills: ["sales"] }, resume_only_score: 71, resume_note: "Sold software", resume_questions: ["q1"] };
    });
    as(cast.recruiter);
    const p = phone();
    const res = await handleImport(jsonReq("POST", { rows: [{ name: "Riya Recruiter", phone: p, resume_text: "Riya Recruiter. Three years of inside sales at an edtech, B.Com." }], consent_confirmed: true }), job.id);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ imported: 1, resumes_read: 1 });
    expect(seen).toEqual(["Riya Recruiter. Three years of inside sales at an edtech, B.Com."]);
    const { data } = await svc.from("candidates").select("resume_only_score, profile").eq("id", body.candidate_ids[0]).single();
    expect(Number(data!.resume_only_score)).toBe(71);
    expect((data!.profile as Record<string, unknown>).resume_text).toBe("Riya Recruiter. Three years of inside sales at an edtech, B.Com.");
  });

  it("recruiter starts a batch (kicks the dispatcher at once), reads progress and stops it", async () => {
    const c1 = await makeCandidate(job);
    const c2 = await makeCandidate(job);
    as(cast.recruiter);
    const res = await handleCreateBatch(jsonReq("POST", { job_id: job.id, candidate_ids: [c1, c2] }), noKick);
    expect(res.status).toBe(201);
    const { batch_id } = await res.json();
    expect(noKick).toHaveBeenCalledWith(job.id);
    const prog = await handleBatchProgress(batch_id);
    expect(prog.status).toBe(200);
    expect(await prog.json()).toMatchObject({ total: 2, callbacks: 0 });
    const stop = await cancelRoute.POST(jsonReq("POST", {}), params({ id: batch_id }));
    expect(stop.status).toBe(200);
    expect(await stop.json()).toMatchObject({ status: "stopped", cancelled: 2, callbacks_kept: 0 });
  });

  it("recruiter can place a 'call now' phone call (no heads-up) and mint a web session", async () => {
    const cand = await makeCandidate(job);
    as(cast.recruiter);
    const res = await handlePhoneCall(jsonReq("POST", { candidate_id: cand }), noKick);
    expect(res.status).toBe(201);
    const [call] = await callsOf(cand);
    expect(call).toMatchObject({ state: "queued", heads_up: false, batch_id: null });
    await svc.from("calls").update({ state: "finished", outcome: "failed" }).eq("candidate_id", cand);

    const runId = execId();
    bolnaReply = (url) =>
      url.endsWith("/web-call/session")
        ? new Response(JSON.stringify({ run_id: runId, sip_username: "u", sip_password: "p", expires_in: 120 }), { status: 200 })
        : new Response("{}", { status: 500 });
    const web = await handleWebSession(jsonReq("POST", { candidate_id: cand }));
    expect(web.status).toBe(200);
    expect(await web.json()).toMatchObject({ run_id: runId });
  });

  it("hiring manager cannot close a job or change lines; other company gets 404", async () => {
    as(cast.hm);
    expect((await closeRoute.POST(jsonReq("POST", {}), params({ id: job.id }))).status).toBe(403);
    expect((await linesRoute.PUT(jsonReq("PUT", { lines: 4 }))).status).toBe(403);
    as(cast.other);
    expect((await closeRoute.POST(jsonReq("POST", {}), params({ id: job.id }))).status).toBe(404);
    const { data } = await svc.from("jobs").select("status").eq("id", job.id).single();
    expect(data!.status).toBe("open");
  });
});

// ===========================================================================
describe("web calls never become phone retries", () => {
  it("a browser call that ends with no answer queues nothing", async () => {
    const job = await makeJob();
    const id = execId();
    const call = await makeCall(job, { state: "dialing", call_kind: "web", bolna_execution_id: id, locked_at: new Date().toISOString() });
    await webhook({ id, status: "no-answer", termination_reason: "no_answer", conversation_duration: 0 });
    const rows = await callsOf(call.candidate_id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ state: "finished", outcome: "no_answer" });
  });
});

// ===========================================================================
describe("Stop really stops", () => {
  it("waiting calls are cancelled, booked callbacks kept, and a call on the line cannot retry", async () => {
    const job = await makeJob();
    const batch = await makeBatch(job);
    const live = execId();
    const onLine = await makeCall(job, { batch_id: batch, state: "in_call", bolna_execution_id: live });
    const waiting = await makeCall(job, { batch_id: batch });
    const callback = await makeCall(job, { batch_id: batch, scheduled: true, reschedule_count: 1, due_at: new Date(Date.now() + 3_600_000).toISOString() });

    as(cast.recruiter);
    const res = await cancelRoute.POST(jsonReq("POST", {}), params({ id: batch }));
    expect(await res.json()).toMatchObject({ status: "stopped", cancelled: 1, callbacks_kept: 1 });
    expect(await callsOf(waiting.candidate_id)).toHaveLength(0);
    expect((await callsOf(callback.candidate_id))[0]).toMatchObject({ state: "queued", scheduled: true });

    // the call that was on the line ends unanswered: no retry for a stopped batch
    await webhook({ id: live, status: "no-answer", termination_reason: "no_answer", conversation_duration: 0 });
    const rows = await callsOf(onLine.candidate_id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ state: "finished", outcome: "no_answer" });
  });

  it("the dispatcher never picks up a non-callback call of a stopped batch; booked callbacks still go out", async () => {
    const job = await makeJob(await makeCompany(5));
    const batch = await makeBatch(job, "stopped");
    const stray = await makeCall(job, { batch_id: batch });
    const cb = await makeCall(job, { batch_id: batch, scheduled: true });
    const { data } = await svc.rpc("claim_due_calls", { p_limit: 10, p_job_id: job.id });
    expect(((data ?? []) as { call_id: string }[]).map((r) => r.call_id)).toEqual([cb.id]);
    expect((await callsOf(stray.candidate_id))[0]).toMatchObject({ state: "queued" });
  });

  it("asking to cancel callbacks too removes them", async () => {
    const job = await makeJob();
    const batch = await makeBatch(job);
    const cb = await makeCall(job, { batch_id: batch, scheduled: true, due_at: new Date(Date.now() + 3_600_000).toISOString() });
    as(cast.admin);
    const res = await cancelRoute.POST(jsonReq("POST", { cancel_callbacks: true }), params({ id: batch }));
    expect(await res.json()).toMatchObject({ cancelled: 1, callbacks_kept: 0 });
    expect(await callsOf(cb.candidate_id)).toHaveLength(0);
  });
});

// ===========================================================================
describe("close job + reject candidate cancel waiting calls", () => {
  it("recruiter closes a job: waiting calls cancelled, callbacks kept and still dialable, batches stopped", async () => {
    const job = await makeJob(await makeCompany(5));
    const batch = await makeBatch(job);
    const waiting = await makeCall(job, { batch_id: batch });
    const cb = await makeCall(job, { scheduled: true });
    as(cast.recruiter);
    // the recruiter is an ACME member; the job lives in a throwaway company, so 404 proves scoping
    expect((await closeRoute.POST(jsonReq("POST", {}), params({ id: job.id }))).status).toBe(404);

    const acmeJob = await makeJob();
    const acmeBatch = await makeBatch(acmeJob);
    const w2 = await makeCall(acmeJob, { batch_id: acmeBatch });
    const cb2 = await makeCall(acmeJob, { scheduled: true, due_at: new Date(Date.now() + 3_600_000).toISOString() });
    const res = await closeRoute.POST(jsonReq("POST", {}), params({ id: acmeJob.id }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "closed", cancelled: 1, callbacks_kept: 1 });
    expect(await callsOf(w2.candidate_id)).toHaveLength(0);
    expect(await callsOf(cb2.candidate_id)).toHaveLength(1);
    expect((await svc.from("batches").select("status").eq("id", acmeBatch).single()).data!.status).toBe("stopped");

    // dispatcher: in a closed job only booked callbacks are dialled
    await svc.from("jobs").update({ status: "closed" }).eq("id", job.id);
    const { data } = await svc.rpc("claim_due_calls", { p_limit: 10, p_job_id: job.id });
    expect(((data ?? []) as { call_id: string }[]).map((r) => r.call_id)).toEqual([cb.id]);
    expect((await callsOf(waiting.candidate_id))[0]).toMatchObject({ state: "queued" });
  });

  it("closing through a job save (status closed) also cancels waiting calls", async () => {
    const job = await makeJob();
    const w = await makeCall(job);
    as(cast.recruiter);
    const res = await jobRoute.PUT(jsonReq("PUT", { status: "closed" }), params({ id: job.id }));
    expect(res.status).toBe(200);
    expect(await callsOf(w.candidate_id)).toHaveLength(0);
  });

  it("recruiter rejects a queued candidate: their waiting calls (callbacks too) are cancelled and noted", async () => {
    const job = await makeJob();
    const cand = await makeCandidate(job, phone(), "queued");
    await makeCall(job, { candidate_id: cand });
    await makeCall(job, { candidate_id: cand, scheduled: true, due_at: new Date(Date.now() + 3_600_000).toISOString() });
    as(cast.recruiter);
    const res = await actionsRoute.POST(jsonReq("POST", { type: "reject" }), params({ id: cand }));
    expect(res.status).toBe(201);
    const { action } = await res.json();
    expect(action.new_value).toMatchObject({ status: "rejected", cancelled_calls: 2 });
    expect(action.note).toBe("2 waiting calls cancelled");
    expect(await callsOf(cand)).toHaveLength(0);
  });

  it("the dispatcher never dials a rejected candidate", async () => {
    const job = await makeJob(await makeCompany(5));
    const cand = await makeCandidate(job, phone(), "rejected");
    await makeCall(job, { candidate_id: cand });
    expect((await svc.rpc("claim_due_calls", { p_limit: 10, p_job_id: job.id })).data).toHaveLength(0);
  });
});

// ===========================================================================
describe("account-wide cap and capacity refusals", () => {
  it("a Bolna 429 puts the call back in 2 minutes without using an attempt", async () => {
    process.env.DISPATCH_ENABLED = "true";
    bolnaReply = () => new Response(JSON.stringify({ error: "concurrency limit" }), { status: 429 });
    const job = await makeJob(await makeCompany(2));
    const call = await makeCall(job, { candidate_id: await makeCandidate(job, "+919000000071"), heads_up: false });
    const r = await runDispatch({ jobId: job.id });
    expect(r).toMatchObject({ requeued: 1, started: 0, failed: 0 });
    const rows = await callsOf(call.candidate_id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ state: "queued", attempt: 1, outcome: null });
    const delay = Date.parse(String(rows[0].due_at)) - Date.now();
    expect(delay).toBeGreaterThan(100_000);
    expect(delay).toBeLessThan(125_000);
  });

  it("a webhook saying Bolna hit its concurrency limit re-queues the same attempt in 2 minutes", async () => {
    const job = await makeJob();
    const id = execId();
    const call = await makeCall(job, { state: "dialing", attempt: 3, bolna_execution_id: id, locked_at: new Date().toISOString() });
    await webhook({ id, status: "failed", termination_reason: "concurrency_limit_reached", conversation_duration: 0 });
    const rows = await callsOf(call.candidate_id);
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ state: "queued", attempt: 3, heads_up: false });
    expect(Date.parse(String(rows[1].due_at)) - Date.now()).toBeLessThan(125_000);
  });

  it("company lines: an admin sets them (1-50); recruiters cannot, not even directly in the database", async () => {
    const { data: before } = await svc.from("companies").select("concurrency_limit").eq("id", ACME).single();
    try {
      as(cast.admin);
      expect((await linesRoute.PUT(jsonReq("PUT", { lines: 0 }))).status).toBe(400);
      expect((await linesRoute.PUT(jsonReq("PUT", { lines: 51 }))).status).toBe(400);
      const ok = await linesRoute.PUT(jsonReq("PUT", { lines: 7 }));
      expect(await ok.json()).toEqual({ lines: 7 });
      as(cast.recruiter);
      expect((await linesRoute.PUT(jsonReq("PUT", { lines: 9 }))).status).toBe(403);
      const direct = await cast.recruiter.from("companies").update({ concurrency_limit: 9 }).eq("id", ACME).select("id");
      expect(direct.error?.code).toBe("42501");
      expect((await svc.from("companies").select("concurrency_limit").eq("id", ACME).single()).data!.concurrency_limit).toBe(7);
    } finally {
      await svc.from("companies").update({ concurrency_limit: before!.concurrency_limit }).eq("id", ACME);
    }
  });
});

// ===========================================================================
describe("heads-up timing", () => {
  it("'call now' calls never get a heads-up", async () => {
    process.env.DISPATCH_ENABLED = "true";
    const job = await makeJob();
    const call = await makeCall(job, { heads_up: false, due_at: new Date(Date.now() + 60_000).toISOString() });
    expect(await sendHeadsUp(call.id, { db: svc })).toEqual({ status: "skipped", reason: "call_now" });
  });

  it("batch calls are queued 2 min ahead while calling is on, and never dialled sooner than 2 min after the heads-up", async () => {
    process.env.DISPATCH_ENABLED = "true";
    const job = await makeJob();
    const c = await makeCandidate(job);
    as(cast.recruiter);
    const res = await handleCreateBatch(jsonReq("POST", { job_id: job.id, candidate_ids: [c] }), noKick);
    expect(res.status).toBe(201);
    const [call] = await callsOf(c);
    expect(Date.parse(String(call.due_at)) - Date.now()).toBeGreaterThan(100_000);

    // pretend the heads-up goes out later than planned: the dial moves to 2 min after it
    await svc.from("calls").update({ due_at: new Date().toISOString() }).eq("id", call.id as string);
    const sent = await sendHeadsUp(call.id as string, { db: svc });
    expect(["logged", "sent"]).toContain(sent.status);
    const after = (await callsOf(c))[0];
    expect(Date.parse(String(after.due_at)) - Date.now()).toBeGreaterThan(100_000);
    await svc.from("calls").delete().eq("id", call.id as string);
  });
});

// ===========================================================================
describe("reschedule function source IP", () => {
  const req = (ip: string) =>
    new Request("http://localhost/api/bolna/reschedule", {
      method: "POST",
      headers: { "content-type": "application/json", "x-bolna-secret": WH_SECRET, "x-forwarded-for": ip },
      body: JSON.stringify({ action: "list", call_id: randomUUID(), slot_iso: "" }),
    });

  it("refuses a non-Bolna IP (403) and answers a Bolna IP", async () => {
    expect((await handleReschedule(req("198.51.100.7"))).status).toBe(403);
    expect((await handleReschedule(req("13.203.39.153"))).status).toBe(200);
  });
});

// ===========================================================================
describe("batch progress + scheduler health", () => {
  it("the newest call row decides a candidate's progress (a callback restarts at attempt 1)", async () => {
    const job = await makeJob();
    const batch = await makeBatch(job);
    const cand = await makeCandidate(job);
    await makeCall(job, { candidate_id: cand, batch_id: batch, attempt: 2, state: "finished", outcome: "rescheduled", created_at: new Date(Date.now() - 60_000).toISOString() });
    await makeCall(job, { candidate_id: cand, batch_id: batch, attempt: 1, scheduled: true, due_at: new Date(Date.now() + 3_600_000).toISOString() });
    as(cast.hm);
    const res = await handleBatchProgress(batch);
    expect(await res.json()).toMatchObject({ total: 1, queued: 1, done: 0, callbacks: 1 });
  });

  it("summariseBatchCalls orders by creation time, not attempt", () => {
    const { latest } = summariseBatchCalls([
      { candidate_id: "a", attempt: 3, state: "finished", outcome: "no_answer", scheduled: false, created_at: "2026-11-16T10:00:00Z" },
      { candidate_id: "a", attempt: 1, state: "queued", outcome: null, scheduled: true, created_at: "2026-11-16T11:00:00Z" },
    ]);
    expect(latest.get("a")?.state).toBe("queued");
  });

  it("scheduler: a fresh tick is 'running'; missing secret, stale or never-ran ticks are not", async () => {
    await recordTick(svc as never);
    const { data } = await cast.recruiter.rpc("scheduler_health");
    expect(data).toMatchObject({ cron_scheduled: true, secret_present: true });
    expect(Date.now() - Date.parse(data.last_tick)).toBeLessThan(60_000);
    expect(JSON.stringify(data)).not.toMatch(/secret"\s*:\s*"/); // booleans only, never a value
    const now = Date.now();
    const iso = (ms: number) => new Date(now - ms).toISOString();
    expect(readSchedulerHealth({ cron_scheduled: true, secret_present: true, url_present: true, last_tick: iso(30_000) }, now).running).toBe(true);
    expect(readSchedulerHealth({ cron_scheduled: true, secret_present: false, url_present: true, last_tick: iso(30_000) }, now).reason).toBe("no_secret");
    expect(readSchedulerHealth({ cron_scheduled: true, secret_present: true, url_present: true, last_tick: iso(4 * 60_000) }, now).reason).toBe("stale");
    expect(readSchedulerHealth({ cron_scheduled: false, secret_present: true, url_present: true, last_tick: null }, now).reason).toBe("not_scheduled");
    expect(readSchedulerHealth({ cron_scheduled: true, secret_present: true, url_present: true, last_tick: null }, now).reason).toBe("never_ran");
  });

  it("signed-out callers get nothing from scheduler_health", async () => {
    const { data, error } = await cast.anon.rpc("scheduler_health");
    expect(data ?? null).toBeNull();
    expect(error).toBeTruthy();
  });
});

// ===========================================================================
describe("resume matching (batch panel)", () => {
  it("matches by the CSV file-name column, then by the applicant's name in the file name", () => {
    const m = matchResumes(
      [
        { key: "1", name: "Riya Sharma", resume_filename: "CVs/riya-final.PDF" },
        { key: "2", name: "Arjun Mehta" },
        { key: "3", name: "Sam" },
        { key: "4", name: "Neha Gupta" },
      ],
      ["riya-final.pdf", "Mehta_Arjun_resume.docx", "random.pdf", "neha gupta.pdf", "neha-gupta-old.pdf"],
    );
    expect(m.get("1")).toBe("riya-final.pdf");
    expect(m.get("2")).toBe("Mehta_Arjun_resume.docx");
    expect(m.has("3")).toBe(false); // no file names "Sam"
    expect(m.has("4")).toBe(false); // two files fit: ambiguous, the recruiter picks
  });
});
