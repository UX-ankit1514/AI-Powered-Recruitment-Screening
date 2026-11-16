/**
 * M6 route tests against the LIVE Supabase project (like tests/ingest/routes.test.ts).
 *
 * Safety: DISPATCH_ENABLED is unset for the whole file except one test that sets it with a FAKE
 * Bolna key and a mocked fetch. Every request to api.bolna.ai is intercepted and recorded; nothing
 * leaves the machine. Test phones are +1 555 01xx (never dialable) except one fake +91 number used
 * only behind the mock. All rows live in throwaway jobs that are deleted afterwards.
 */
import { randomInt, randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SEED, adminClient, seed } from "../../scripts/seed";
import { clearOfLiveDispatcher } from "../security/helpers";

const h = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("server-only", () => ({}));
vi.mock("../../lib/supabase/server", () => ({
  createClient: async () => h.client,
  getUserClaims: async () => null,
}));
vi.mock("../../lib/supabase/admin", async () => {
  const { adminClient: make } = await import("../../scripts/seed");
  return { createAdminClient: () => make() };
});
vi.mock("../../lib/ai", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../../lib/ai")>();
  return {
    ...orig,
    scoreCall: vi.fn(),
    // webhook-time call classification: offline here, so the heuristic fallback runs (no network)
    classifyCall: vi.fn(async () => {
      throw new Error("offline");
    }),
    writeCallBrief: vi.fn(async (_p: unknown, _r: unknown, job: { title: string }, company: { name: string }, opts: { callId?: string }) => ({
      call_id: opts.callId,
      first_name: "Test",
      role: job.title,
      company: company.name,
      resume_note: "note",
      resume_q1: "q1",
      resume_q2: "q2",
      must_haves: "- x",
      jd_summary: "jd",
      faq: "",
      culture_values: "",
      traits: "",
      other_interest_prompt: "",
    })),
  };
});

import { scoreCall } from "../../lib/ai";
import { handleBolnaWebhook } from "../../lib/calls/webhook";
import { handleReschedule } from "../../lib/calls/reschedule";
import { handleDispatch, runDispatch } from "../../lib/calls/dispatch";
import { handleCreateBatch } from "../../lib/ingest/batches";
import { handlePhoneCall, handleWebSession } from "../../lib/calls/single";
import { APP_AGENT_ID } from "../../lib/calls/config";

type DB = SupabaseClient;
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const ACME = SEED.acme.id;
const service = adminClient() as unknown as DB;
const scoreMock = vi.mocked(scoreCall);

// dispatcher tests first wait (up to ~30 s) for a moment clear of the live cron dispatcher
vi.setConfig({ testTimeout: 90_000 });

const WH_SECRET = `test-wh-${randomUUID()}`;
const DISPATCH_SECRET = `test-dispatch-${randomUUID()}`;
const ALL_HOURS = { start: "00:00", end: "24:00", days: [0, 1, 2, 3, 4, 5, 6] };
const OFFICE_HOURS = { start: "10:00", end: "19:00", days: [1, 2, 3, 4, 5, 6] };

// ---- fetch interception: Bolna + our own dispatcher kick never hit the network ----
const realFetch = globalThis.fetch;
const bolnaRequests: { url: string; body: Record<string, unknown> | null }[] = [];
const kicks: string[] = [];
let bolnaReply: (url: string) => Response = () => new Response(JSON.stringify({ error: "not mocked" }), { status: 500 });
const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.startsWith("https://api.bolna.ai")) {
    bolnaRequests.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
    return bolnaReply(url);
  }
  if (url.startsWith("http://localhost:3999")) {
    kicks.push(url);
    return new Response("{}", { status: 200 });
  }
  return realFetch(input, init);
});

const saved: Record<string, string | undefined> = {};
const ENV_KEYS = ["DISPATCH_ENABLED", "BOLNA_WEBHOOK_SECRET", "DISPATCH_SECRET", "BOLNA_API_KEY", "APP_BASE_URL", "BOLNA_IP_CHECK", "BOLNA_APP_AGENT_ID", "BOLNA_FROM_NUMBER"];

let anon: DB, acmeAdmin: DB, acmeHm: DB, otherAdmin: DB;
const jobs: string[] = [];
const companies: string[] = [];
const execIds: string[] = [];
let jobId = ""; // all-hours job, concurrency 2
let otherOpenJobTitle = "";

const as = (c: DB) => {
  h.client = c;
};
const testPhone = () => `+1555010${String(randomInt(0, 9999)).padStart(4, "0")}`;
const execId = () => {
  const id = `test-m6-${randomUUID()}`;
  execIds.push(id);
  return id;
};

function anonClient(): DB {
  return createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
}
async function signedIn(email: string, pwEnv: string): Promise<DB> {
  const c = anonClient();
  const { error } = await c.auth.signInWithPassword({ email, password: process.env[pwEnv]! });
  if (error) throw new Error(`sign-in failed for ${email}`);
  return c;
}

/**
 * A throwaway company of its own: the line cap is company-wide, so dispatcher tests must not share
 * ACME with the in-flight rows other tests (and other test files) leave around while they run.
 */
async function makeCompany(lines: number | null = 2) {
  const { data, error } = await service.from("companies").insert({ name: `M6 test co ${randomInt(0, 99999)}`, concurrency_limit: lines }).select("id").single();
  if (error) throw error;
  companies.push(data.id);
  return data.id as string;
}

async function makeJob(opts: { hours?: object; limit?: number; title?: string; company?: string } = {}) {
  const { data, error } = await service
    .from("jobs")
    .insert({
      company_id: opts.company ?? ACME,
      title: opts.title ?? "M6 test job",
      jd_text: "test",
      calling_hours: opts.hours ?? ALL_HOURS,
      concurrency_limit: opts.limit ?? 2,
      culture_values: [{ name: "Ownership", description: "Owns it" }],
    })
    .select("id")
    .single();
  if (error) throw error;
  jobs.push(data.id);
  return data.id as string;
}

const companyOf = async (job: string) => ((await service.from("jobs").select("company_id").eq("id", job).single()).data as { company_id: string }).company_id;

async function makeCandidate(job: string, phone = testPhone(), status = "imported") {
  const { data, error } = await service
    .from("candidates")
    .insert({ company_id: await companyOf(job), job_id: job, name: "Rahul Test", phone, source: "csv", status, profile: { resume_note: "3 yrs field sales" } })
    .select("id")
    .single();
  if (error) throw error;
  return data.id as string;
}

async function makeCall(job: string, patch: Record<string, unknown> = {}) {
  const candidate_id = (patch.candidate_id as string) ?? (await makeCandidate(job));
  const { data, error } = await service
    .from("calls")
    .insert({ candidate_id, job_id: job, company_id: await companyOf(job), state: "queued", due_at: new Date().toISOString(), ...patch })
    .select("*")
    .single();
  if (error) throw error;
  return data as Record<string, unknown> & { id: string; candidate_id: string };
}

const getCall = async (id: string) => (await service.from("calls").select("*").eq("id", id).single()).data as Record<string, unknown>;
const getCandidate = async (id: string) => (await service.from("candidates").select("*").eq("id", id).single()).data as Record<string, unknown>;

// webhook helper: runs the deferred processing to completion
async function webhook(payload: unknown, opts: { secret?: string | null; ip?: string } = {}) {
  const tasks: Promise<unknown>[] = [];
  const secret = opts.secret === undefined ? WH_SECRET : opts.secret;
  const url = `http://localhost/api/webhooks/bolna${secret === null ? "" : `?secret=${encodeURIComponent(secret)}`}`;
  const res = await handleBolnaWebhook(
    new Request(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...(opts.ip ? { "x-forwarded-for": `${opts.ip}, 10.0.0.1` } : {}) },
      body: JSON.stringify(payload),
    }),
    (t) => tasks.push(t()),
  );
  await Promise.all(tasks);
  return res;
}

const rescheduleReq = (body: unknown, secret: string | null = WH_SECRET) =>
  new Request("http://localhost/api/bolna/reschedule", {
    method: "POST",
    headers: { "content-type": "application/json", ...(secret ? { "x-bolna-secret": secret } : {}) },
    body: JSON.stringify(body),
  });

const jsonReq = (body: unknown) =>
  new Request("http://localhost/api", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

const TRANSCRIPT = "assistant: Hi, am I speaking with Rahul?\nuser: Yes. I sold field software for three years.\nassistant: Thanks.";
function scoreResult(over: Record<string, unknown> = {}) {
  return {
    qualities: { skills: { score: 4, reason: "ok", quotes: [] }, experience: { score: 4, reason: "ok", quotes: [] } },
    must_have_results: [{ text: "Hindi", met: true, quote: null }],
    flags: { other_role: null, culture_standout: false, wants_internship: false, resume_mismatch: [], hr_review: null },
    summary: "Solid.",
    profile_updates: null,
    short_exit: false,
    conduct_ended: false,
    callback_requested_at: null,
    model_version: "test-model",
    prompt_version: "test-prompt",
    ...over,
  };
}

beforeAll(async () => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  delete process.env.DISPATCH_ENABLED;
  delete process.env.BOLNA_IP_CHECK;
  delete process.env.BOLNA_APP_AGENT_ID;
  delete process.env.BOLNA_FROM_NUMBER;
  process.env.BOLNA_WEBHOOK_SECRET = WH_SECRET;
  process.env.DISPATCH_SECRET = DISPATCH_SECRET;
  process.env.BOLNA_API_KEY = "test-key-not-real";
  process.env.APP_BASE_URL = "http://localhost:3999";
  vi.stubGlobal("fetch", fetchMock);

  await seed();
  anon = anonClient();
  acmeAdmin = await signedIn(SEED.users.acmeAdmin.email, SEED.users.acmeAdmin.passwordEnv);
  acmeHm = await signedIn(SEED.users.acmeHm.email, SEED.users.acmeHm.passwordEnv);
  otherAdmin = await signedIn(SEED.users.otherAdmin.email, SEED.users.otherAdmin.passwordEnv);

  jobId = await makeJob();
  otherOpenJobTitle = `M6 other role ${randomInt(0, 9999)}`;
  await makeJob({ title: otherOpenJobTitle });
  const { error } = await service.from("rubrics").insert({
    job_id: jobId,
    company_id: ACME,
    version: 3,
    must_haves: [{ text: "Hindi" }],
    weights: { skills: 50, experience: 50 },
    custom_traits: [{ key: "grit", name: "Grit", description: "keeps going" }],
  });
  if (error) throw error;
});

afterAll(async () => {
  vi.unstubAllGlobals();
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  if (execIds.length) await service.from("webhook_events").delete().in("bolna_execution_id", execIds);
  if (jobs.length) await service.from("jobs").delete().in("id", jobs); // cascades
  if (companies.length) await service.from("companies").delete().in("id", companies);
});

beforeEach(() => {
  delete process.env.DISPATCH_ENABLED;
  bolnaRequests.length = 0;
  kicks.length = 0;
  scoreMock.mockReset();
});

// ===========================================================================
describe("webhook auth + storage", () => {
  it("rejects a missing or wrong secret and stores nothing", async () => {
    const id = execId();
    expect((await webhook({ id, status: "ringing" }, { secret: null })).status).toBe(401);
    expect((await webhook({ id, status: "ringing" }, { secret: "wrong" })).status).toBe(401);
    expect((await webhook({ id, status: "ringing" }, { secret: WH_SECRET.slice(0, -1) })).status).toBe(401);
    const { data } = await service.from("webhook_events").select("id").eq("bolna_execution_id", id);
    expect(data).toHaveLength(0);
  });

  it("rejects a non-Bolna source IP, accepts a Bolna IP", async () => {
    const id = execId();
    expect((await webhook({ id, status: "ringing" }, { ip: "198.51.100.7" })).status).toBe(403);
    expect((await webhook({ id, status: "ringing" }, { ip: "13.126.9.249" })).status).toBe(200);
  });

  it("is idempotent: the same event twice is stored once", async () => {
    const id = execId();
    const call = await makeCall(jobId, { state: "dialing", bolna_execution_id: id, locked_at: new Date().toISOString() });
    const r1 = await webhook({ id, status: "in-progress" });
    const r2 = await webhook({ id, status: "in-progress" });
    expect(r1.status).toBe(200);
    expect(await r2.json()).toMatchObject({ ok: true, duplicate: true });
    const { data } = await service.from("webhook_events").select("id, payload").eq("bolna_execution_id", id);
    expect(data).toHaveLength(1);
    expect((await getCall(call.id)).state).toBe("in_call");
  });

  it("acknowledges an unknown execution (200) without touching calls", async () => {
    const res = await webhook({ id: execId(), status: "completed", transcript: TRANSCRIPT, conversation_duration: 30 });
    expect(res.status).toBe(200);
    expect(scoreMock).not.toHaveBeenCalled();
  });
});

describe("webhook status mapping + retries", () => {
  it("ringing → dialing, in-progress → in_call, no-answer → requeue +30 min", async () => {
    const id = execId();
    const call = await makeCall(jobId, { state: "dialing", bolna_execution_id: id, locked_at: new Date().toISOString() });
    await webhook({ id, status: "ringing" });
    expect((await getCall(call.id)).state).toBe("dialing");
    await webhook({ id, status: "in-progress" });
    const live = await getCall(call.id);
    expect(live.state).toBe("in_call");
    expect(live.started_at).toBeTruthy();
    expect((await getCandidate(call.candidate_id)).status).toBe("calling");

    await webhook({ id, status: "no-answer", termination_reason: "no_answer", conversation_duration: 0 });
    const done = await getCall(call.id);
    expect(done).toMatchObject({ state: "finished", outcome: "no_answer", termination_reason: "no_answer" });
    const { data: next } = await service.from("calls").select("*").eq("candidate_id", call.candidate_id).eq("attempt", 2);
    expect(next).toHaveLength(1);
    const delay = Date.parse(next![0].due_at) - Date.now();
    expect(delay).toBeGreaterThan(28 * 60_000);
    expect(delay).toBeLessThan(31 * 60_000);
    expect((await getCandidate(call.candidate_id)).status).toBe("queued");
    expect(kicks.length).toBeGreaterThan(0); // dispatcher nudged after a terminal webhook
  });

  it("third busy attempt does not retry; candidate back to imported", async () => {
    const id = execId();
    const call = await makeCall(jobId, { state: "in_call", attempt: 3, bolna_execution_id: id });
    await webhook({ id, status: "busy", termination_reason: "busy" });
    expect(await getCall(call.id)).toMatchObject({ state: "finished", outcome: "busy" });
    const { data } = await service.from("calls").select("id").eq("candidate_id", call.candidate_id);
    expect(data).toHaveLength(1);
    expect((await getCandidate(call.candidate_id)).status).toBe("imported");
  });

  it("a late in-progress never reopens a finished call", async () => {
    const id = execId();
    const call = await makeCall(jobId, { state: "finished", outcome: "busy", bolna_execution_id: id });
    await webhook({ id, status: "in-progress" });
    expect((await getCall(call.id)).state).toBe("finished");
  });
});

describe("webhook scoring path", () => {
  const completed = (id: string, over: Record<string, unknown> = {}) => ({
    id,
    agent_id: APP_AGENT_ID,
    status: "completed",
    termination_reason: "agent_ended_call",
    conversation_duration: 182,
    total_cost: 9.5,
    transcript: TRANSCRIPT,
    initiated_at: new Date().toISOString(),
    telephony_data: { duration: 190, recording_url: "https://recordings.example/x.mp3" },
    ...over,
  });

  it("completed → stores transcript/recording/cost, scores with full context, candidate scored", async () => {
    scoreMock.mockResolvedValue(scoreResult() as never);
    const id = execId();
    const call = await makeCall(jobId, { state: "in_call", bolna_execution_id: id });
    await webhook({ id, status: "call-disconnected" });
    expect(scoreMock).not.toHaveBeenCalled(); // content only on completed
    await webhook(completed(id));
    // duplicate completed: stored once, scored once
    await webhook(completed(id));

    expect(scoreMock).toHaveBeenCalledTimes(1);
    const arg = scoreMock.mock.calls[0]![0];
    expect(arg).toMatchObject({ transcript: TRANSCRIPT, role: "M6 test job", resumeNote: "3 yrs field sales", candidateName: "Rahul Test" });
    expect(arg.mustHaves).toEqual([{ text: "Hindi" }]);
    expect(arg.customTraits).toEqual([{ key: "grit", name: "Grit", description: "keeps going" }]);
    expect(arg.cultureValues).toEqual([{ name: "Ownership", description: "Owns it" }]);
    expect((arg.openRoles ?? []).map((r) => (typeof r === "string" ? r : r.title))).toContain(otherOpenJobTitle);
    expect(arg.callTime).toBeTruthy();

    const row = await getCall(call.id);
    expect(row).toMatchObject({ state: "finished", outcome: "completed", duration_s: 182, recording_url: "https://recordings.example/x.mp3", transcript: TRANSCRIPT });
    expect(Number(row.cost)).toBe(9.5);
    const { data: scores } = await service.from("scores").select("*").eq("call_id", call.id);
    expect(scores).toHaveLength(1);
    expect(scores![0]).toMatchObject({ rubric_version: 3, summary: "Solid.", model_version: "test-model", short_exit: false });
    expect((await getCandidate(call.candidate_id)).status).toBe("scored");
  });

  it("short exit is recorded as the outcome", async () => {
    scoreMock.mockResolvedValue(scoreResult({ short_exit: true }) as never);
    const id = execId();
    const call = await makeCall(jobId, { state: "in_call", bolna_execution_id: id });
    await webhook(completed(id));
    expect((await getCall(call.id)).outcome).toBe("short_exit");
  });

  it("callback requested in the transcript → new queued call at that time, outcome rescheduled", async () => {
    const at = new Date(Date.now() + 26 * 3_600_000);
    at.setUTCMinutes(30, 0, 0);
    scoreMock.mockResolvedValue(scoreResult({ callback_requested_at: at.toISOString() }) as never);
    const id = execId();
    const call = await makeCall(jobId, { state: "in_call", bolna_execution_id: id });
    await webhook(completed(id));
    expect((await getCall(call.id)).outcome).toBe("rescheduled");
    const { data: next } = await service.from("calls").select("*").eq("candidate_id", call.candidate_id).neq("id", call.id);
    expect(next).toHaveLength(1);
    expect(next![0]).toMatchObject({ state: "queued", reschedule_count: 1, scheduled: true });
    expect(Date.parse(next![0].due_at)).toBe(at.getTime());
  });

  it("callback request is ignored once the reschedule cap is reached", async () => {
    scoreMock.mockResolvedValue(scoreResult({ callback_requested_at: new Date(Date.now() + 86_400_000).toISOString() }) as never);
    const id = execId();
    const call = await makeCall(jobId, { state: "in_call", bolna_execution_id: id, reschedule_count: 2 });
    await webhook(completed(id));
    expect((await getCall(call.id)).outcome).toBe("completed");
    const { data } = await service.from("calls").select("id").eq("candidate_id", call.candidate_id);
    expect(data).toHaveLength(1);
  });

  it("a call booked mid-call keeps outcome rescheduled and is not scored", async () => {
    const id = execId();
    const call = await makeCall(jobId, {
      state: "in_call",
      bolna_execution_id: id,
      outcome: "rescheduled",
      callback_at: new Date(Date.now() + 86_400_000).toISOString(),
    });
    await webhook(completed(id, { conversation_duration: 25 }));
    expect(await getCall(call.id)).toMatchObject({ state: "finished", outcome: "rescheduled" });
    expect(scoreMock).not.toHaveBeenCalled();
  });

  it("joins by context_details.recipient_data.call_id when the execution id was never stored", async () => {
    scoreMock.mockResolvedValue(scoreResult() as never);
    const id = execId();
    const call = await makeCall(jobId, { state: "dialing" });
    await webhook(completed(id, { context_details: { recipient_data: { call_id: call.id } } }));
    expect(await getCall(call.id)).toMatchObject({ bolna_execution_id: id, state: "finished", outcome: "completed" });
  });
});

// ===========================================================================
describe("reschedule function", () => {
  let officeJob = "";
  beforeAll(async () => {
    officeJob = await makeJob({ hours: OFFICE_HOURS, limit: 1 });
  });

  it("bad secret → 401", async () => {
    expect((await handleReschedule(rescheduleReq({ call_id: randomUUID(), action: "list", slot_iso: "" }, null))).status).toBe(401);
    expect((await handleReschedule(rescheduleReq({ call_id: randomUUID(), action: "list", slot_iso: "" }, "nope"))).status).toBe(401);
  });

  it("list → 3 speakable slots inside calling hours; full slots skipped; book → queued call", async () => {
    const now = new Date("2026-11-16T05:10:00Z"); // Mon 10:40 IST
    {
      const call = await makeCall(officeJob, { state: "in_call", bolna_execution_id: execId(), created_at: new Date(now.getTime() - 600_000).toISOString() });
      // Fill 12:00 IST (limit 1 per slot)
      await makeCall(officeJob, { state: "queued", due_at: "2026-11-16T06:30:00Z" });

      const res = await handleReschedule(rescheduleReq({ call_id: call.id, action: "list", slot_iso: "" }), now);
      expect(res.status).toBe(200);
      const list = (await res.json()) as { slots: string[]; slot_isos: string[] };
      expect(list.slot_isos).toEqual(["2026-11-16T07:30:00Z", "2026-11-16T10:30:00Z", "2026-11-17T04:30:00Z"]);
      expect(list.slots).toEqual(["today 1 pm", "today 4 pm", "tomorrow 10 am"]);

      const full = await handleReschedule(rescheduleReq({ call_id: call.id, action: "book", slot_iso: "2026-11-16T06:30:00Z" }), now);
      expect(await full.json()).toMatchObject({ booked: false });

      const off = await handleReschedule(rescheduleReq({ call_id: call.id, action: "book", slot_iso: "2026-11-16T21:30:00Z" }), now); // 3 am IST
      expect(await off.json()).toMatchObject({ booked: false });

      const ok = await handleReschedule(rescheduleReq({ call_id: call.id, action: "book", slot_iso: list.slot_isos[1] }), now);
      expect(await ok.json()).toEqual({ booked: true, spoken: "today at 4 pm" });
      const orig = await getCall(call.id);
      expect(orig.outcome).toBe("rescheduled");
      expect(Date.parse(String(orig.callback_at))).toBe(Date.parse(list.slot_isos[1]!));
      const { data: next } = await service.from("calls").select("*").eq("candidate_id", call.candidate_id).neq("id", call.id);
      expect(next).toHaveLength(1);
      expect(next![0]).toMatchObject({ state: "queued", reschedule_count: 1, scheduled: true });

      // repeat of the same booking is idempotent; a different slot is refused
      expect(await (await handleReschedule(rescheduleReq({ call_id: call.id, action: "book", slot_iso: list.slot_isos[1] }), now)).json()).toMatchObject({ booked: true });
      expect(await (await handleReschedule(rescheduleReq({ call_id: call.id, action: "book", slot_iso: list.slot_isos[2] }), now)).json()).toMatchObject({ booked: false });
      const { data: all } = await service.from("calls").select("id").eq("candidate_id", call.candidate_id);
      expect(all).toHaveLength(2);
    }
  });

  it("limit: a call already rescheduled twice gets no slots and cannot book", async () => {
    const call = await makeCall(jobId, { state: "in_call", reschedule_count: 2, bolna_execution_id: execId() });
    const list = await (await handleReschedule(rescheduleReq({ call_id: call.id, action: "list", slot_iso: "" }))).json();
    expect(list).toEqual({ slots: [], slot_isos: [] });
    const slot = new Date(Date.now() + 3 * 3_600_000);
    slot.setUTCMinutes(30, 0, 0);
    const book = await (await handleReschedule(rescheduleReq({ call_id: call.id, action: "book", slot_iso: slot.toISOString() }))).json();
    expect(book).toEqual({ booked: false, reason: "reschedule limit reached" });
  });

  it("unknown / malformed call_id → booked:false (200)", async () => {
    const r1 = await handleReschedule(rescheduleReq({ call_id: randomUUID(), action: "book", slot_iso: new Date().toISOString() }));
    expect(r1.status).toBe(200);
    expect(await r1.json()).toMatchObject({ booked: false });
    const r2 = await handleReschedule(rescheduleReq({ call_id: "'; drop table calls;--", action: "list", slot_iso: "" }));
    expect(await r2.json()).toEqual({ slots: [], slot_isos: [] });
  });
});

// ===========================================================================
describe("dispatcher", () => {
  const dispatchReq = (secret: string | null, body: unknown = {}) =>
    new Request("http://localhost/api/dispatch", {
      method: "POST",
      headers: { "content-type": "application/json", ...(secret ? { "x-dispatch-secret": secret } : {}) },
      body: JSON.stringify(body),
    });

  it("rejects a missing or wrong secret", async () => {
    expect((await handleDispatch(dispatchReq(null))).status).toBe(401);
    expect((await handleDispatch(dispatchReq("wrong"))).status).toBe(401);
  });

  it("claims never exceed the COMPANY's line cap across all its jobs (2 jobs x 5 queued, 2 lines), even with parallel dispatchers", async () => {
    await clearOfLiveDispatcher();
    const co = await makeCompany(2);
    const jobA = await makeJob({ company: co, limit: 50 });
    const jobB = await makeJob({ company: co, limit: 50 });
    for (let i = 0; i < 5; i++) {
      await makeCall(jobA);
      await makeCall(jobB);
    }
    const claims = await Promise.all([
      service.rpc("claim_due_calls", { p_limit: 10, p_job_id: jobA }),
      service.rpc("claim_due_calls", { p_limit: 10, p_job_id: jobB }),
      service.rpc("claim_due_calls", { p_limit: 10, p_job_id: jobA }),
      service.rpc("claim_due_calls", { p_limit: 10, p_job_id: jobB }),
    ]);
    const total = claims.reduce((n, c) => n + ((c.data as unknown[]) ?? []).length, 0);
    expect(total).toBe(2);
    expect((await service.rpc("claim_due_calls", { p_limit: 10, p_job_id: jobB })).data).toHaveLength(0);
    const { count } = await service.from("calls").select("id", { count: "exact", head: true }).eq("company_id", co).eq("state", "dialing");
    expect(count).toBe(2);
  });

  it("company lines unset → the server default (p_default_lines) applies; another company's calls are unaffected", async () => {
    await clearOfLiveDispatcher();
    const co = await makeCompany(null);
    const job = await makeJob({ company: co });
    for (let i = 0; i < 4; i++) await makeCall(job);
    const r = await service.rpc("claim_due_calls", { p_limit: 10, p_job_id: job, p_default_lines: 3 });
    expect(r.data).toHaveLength(3);
    const other = await makeCompany(1);
    const job2 = await makeJob({ company: other });
    await makeCall(job2);
    expect((await service.rpc("claim_due_calls", { p_limit: 10, p_job_id: job2 })).data).toHaveLength(1);
  });

  it("does not claim outside calling hours or before due_at", async () => {
    const co = await makeCompany(5);
    const closed = await makeJob({ company: co, hours: { start: "10:00", end: "19:00", days: [] } });
    await makeCall(closed);
    expect((await service.rpc("claim_due_calls", { p_limit: 10, p_job_id: closed })).data).toHaveLength(0);
    const later = await makeJob({ company: co });
    await makeCall(later, { due_at: new Date(Date.now() + 3_600_000).toISOString() });
    expect((await service.rpc("claim_due_calls", { p_limit: 10, p_job_id: later })).data).toHaveLength(0);
  });

  it("SAFETY LOCK: DISPATCH_ENABLED unset → calls blocked, Bolna never contacted", async () => {
    await clearOfLiveDispatcher();
    expect(process.env.DISPATCH_ENABLED).toBeUndefined();
    // own company with 2 lines: rows other tests leave in flight cannot change the counts below
    const job = await makeJob({ company: await makeCompany(2) });
    const a = await makeCall(job, { candidate_id: await makeCandidate(job, "+919000000001") }); // valid-looking Indian mobile
    const b = await makeCall(job);
    const c = await makeCall(job);
    const r1 = (await (await handleDispatch(dispatchReq(DISPATCH_SECRET, { job_id: job }))).json()) as { started: number; blocked: number };
    expect(r1.started).toBe(0);
    expect(r1.blocked).toBeGreaterThan(0);
    expect(r1.blocked).toBeLessThanOrEqual(2); // 2 lines: never more than 2 claimed in one go
    const r2 = await runDispatch({ jobId: job });
    expect(r2).toMatchObject({ started: 0, in_flight: 0 });
    for (const call of [a, b, c]) {
      expect(await getCall(call.id)).toMatchObject({ state: "finished", outcome: "failed", termination_reason: "dispatch_blocked", bolna_execution_id: null });
    }
    expect(bolnaRequests).toHaveLength(0);
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes("api.bolna.ai"))).toBe(false);
  });

  it("SAFETY LOCK: DISPATCH_ENABLED=false or a non-Indian number → blocked, Bolna never contacted", async () => {
    const job = await makeJob({ company: await makeCompany(2) });
    process.env.DISPATCH_ENABLED = "false";
    const a = await makeCall(job, { candidate_id: await makeCandidate(job, "+919000000002") });
    await runDispatch({ jobId: job });
    expect((await getCall(a.id)).termination_reason).toBe("dispatch_blocked");

    process.env.DISPATCH_ENABLED = "true";
    const b = await makeCall(job); // +1 555 test number
    await runDispatch({ jobId: job });
    expect((await getCall(b.id)).termination_reason).toBe("dispatch_blocked");
    expect(bolnaRequests).toHaveLength(0);
  });

  it("enabled + Indian mobile → POST /call with the app agent and full user_data (mocked Bolna)", async () => {
    await clearOfLiveDispatcher();
    process.env.DISPATCH_ENABLED = "true";
    const exec = execId();
    bolnaReply = () => new Response(JSON.stringify({ message: "done", status: "queued", execution_id: exec }), { status: 200 });
    const job = await makeJob({ company: await makeCompany(2) });
    const call = await makeCall(job, { candidate_id: await makeCandidate(job, "+919000000003") });
    const r = await runDispatch({ jobId: job });
    expect(r).toMatchObject({ started: 1, in_flight: 1 });
    expect(bolnaRequests).toHaveLength(1);
    expect(bolnaRequests[0]!.url).toBe("https://api.bolna.ai/call");
    const body = bolnaRequests[0]!.body!;
    expect(body.agent_id).toBe(APP_AGENT_ID);
    expect(body.recipient_phone_number).toBe("+919000000003");
    const ud = body.user_data as Record<string, string>;
    expect(ud.call_id).toBe(call.id);
    for (const k of ["first_name", "role", "company", "jd_summary", "resume_note", "resume_q1", "resume_q2", "must_haves", "culture_values", "faq"]) {
      expect(typeof ud[k]).toBe("string");
    }
    expect(await getCall(call.id)).toMatchObject({ state: "dialing", bolna_execution_id: exec });
    expect((await getCandidate(call.candidate_id)).status).toBe("calling");
    delete process.env.DISPATCH_ENABLED;
  });
});

// ===========================================================================
describe("per-role auth: batch + single-call routes", () => {
  let candidateId = "";
  const noKick = vi.fn();
  beforeAll(async () => {
    candidateId = await makeCandidate(jobId);
  });

  it("unauthenticated → 401 everywhere", async () => {
    as(anon);
    expect((await handleCreateBatch(jsonReq({ job_id: jobId }), noKick)).status).toBe(401);
    expect((await handlePhoneCall(jsonReq({ candidate_id: candidateId }), noKick)).status).toBe(401);
    expect((await handleWebSession(jsonReq({ candidate_id: candidateId }))).status).toBe(401);
  });

  it("hiring_manager → 403 everywhere", async () => {
    as(acmeHm);
    expect((await handleCreateBatch(jsonReq({ job_id: jobId }), noKick)).status).toBe(403);
    expect((await handlePhoneCall(jsonReq({ candidate_id: candidateId }), noKick)).status).toBe(403);
    expect((await handleWebSession(jsonReq({ candidate_id: candidateId }))).status).toBe(403);
  });

  it("other company's admin is blocked (404, nothing created)", async () => {
    as(otherAdmin);
    expect((await handleCreateBatch(jsonReq({ job_id: jobId }), noKick)).status).toBe(404);
    expect((await handlePhoneCall(jsonReq({ candidate_id: candidateId }), noKick)).status).toBe(404);
    expect((await handleWebSession(jsonReq({ candidate_id: candidateId }))).status).toBe(404);
    const { data } = await service.from("calls").select("id").eq("candidate_id", candidateId);
    expect(data).toHaveLength(0);
    expect(bolnaRequests).toHaveLength(0);
    expect(noKick).not.toHaveBeenCalled();
  });

  it("admin: phone call queues an immediate call and kicks the dispatcher; duplicate → 409", async () => {
    as(acmeAdmin);
    const res = await handlePhoneCall(jsonReq({ candidate_id: candidateId }), noKick);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toMatchObject({ call: { state: "queued" }, dispatch_enabled: false });
    expect(noKick).toHaveBeenCalledWith(jobId);
    expect((await handlePhoneCall(jsonReq({ candidate_id: candidateId }), noKick)).status).toBe(409);
    expect(bolnaRequests).toHaveLength(0); // queuing never dials by itself
    await service.from("calls").update({ state: "finished", outcome: "failed" }).eq("candidate_id", candidateId);
  });

  it("admin: web session mints for the app agent and records a web call with run_id", async () => {
    as(acmeAdmin);
    const runId = execId();
    bolnaReply = (url) =>
      url.endsWith("/web-call/session")
        ? new Response(JSON.stringify({ run_id: runId, agent_id: APP_AGENT_ID, sip_username: "u", sip_password: "p", expires_in: 120 }), { status: 200 })
        : new Response("{}", { status: 500 });
    const res = await handleWebSession(jsonReq({ candidate_id: candidateId }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ run_id: runId, sip_username: "u" });
    expect(bolnaRequests).toHaveLength(1);
    expect(bolnaRequests[0]!.body).toMatchObject({ agent_id: APP_AGENT_ID });
    const { data } = await service.from("calls").select("*").eq("bolna_execution_id", runId).single();
    expect(data).toMatchObject({ call_kind: "web", candidate_id: candidateId, state: "dialing" });
    expect((bolnaRequests[0]!.body!.user_data as Record<string, string>).call_id).toBe(data!.id);
  });

  it("admin: a batch queues imported candidates and kicks the dispatcher straight away", async () => {
    as(acmeAdmin);
    const job = await makeJob();
    await makeCandidate(job);
    await makeCandidate(job);
    const res = await handleCreateBatch(jsonReq({ job_id: job }), noKick);
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ queued: 2 });
    expect(noKick).toHaveBeenCalledWith(job);
    const { count } = await service.from("calls").select("id", { count: "exact", head: true }).eq("job_id", job).eq("state", "queued");
    expect(count).toBe(2);
  });
});
