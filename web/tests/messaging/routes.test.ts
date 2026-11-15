/**
 * Messaging route tests against the LIVE Supabase project (like tests/calls/routes.test.ts).
 *
 * Safety: MESSAGING_PROVIDER is forced to the log provider, so nothing is ever sent; fetch is not
 * used. Test calls are created with due_at in the future so the production dispatcher never claims
 * them. All rows live in throwaway jobs (deleted afterwards; cascades) plus OTP message rows for
 * +1 555 01xx test numbers (deleted explicitly). The global sweep is never run, only per-job.
 */
import { randomInt, randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SEED, adminClient, seed } from "../../scripts/seed";

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

import { handleOtpStart, handleOtpVerify } from "../../lib/messaging/otp";
import { handleSweep, runSweep, sendHeadsUp } from "../../lib/messaging/heads-up";
import { bookPickTime, loadPickView } from "../../lib/messaging/pick-time";
import { handleListMessages } from "../../lib/messaging/admin";
import { signPickToken, verifyPickToken } from "../../lib/messaging/crypto";
import { POST as applyPOST } from "../../app/api/apply/[jobId]/route";

type DB = SupabaseClient;
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const ACME = SEED.acme.id;
const OTHER = SEED.other.id;
const service = adminClient() as unknown as DB;

const ALL_HOURS = { start: "00:00", end: "24:00", days: [0, 1, 2, 3, 4, 5, 6] };
const NEVER_HOURS = { start: "00:00", end: "00:01", days: [0, 1, 2, 3, 4, 5, 6] };
const DISPATCH_SECRET = `test-msg-dispatch-${randomUUID()}`;
const ENV_KEYS = ["DISPATCH_ENABLED", "DISPATCH_SECRET", "APP_BASE_URL", "MESSAGING_PROVIDER", "PICK_TIME_SECRET"];
const saved: Record<string, string | undefined> = {};

let anon: DB, acmeAdmin: DB, acmeHm: DB, otherAdmin: DB;
const jobs: string[] = [];
const testPhones: string[] = [];
let jobId = ""; // all-hours, 1 line
let otherJobId = "";

const as = (c: DB) => {
  h.client = c;
};
const testPhone = () => {
  const p = `+1555010${String(randomInt(0, 9999)).padStart(4, "0")}`;
  testPhones.push(p);
  return p;
};
const ip = () => `10.${randomInt(0, 255)}.${randomInt(0, 255)}.${randomInt(1, 254)}`;
const soon = () => new Date(Date.now() + 10 * 60_000).toISOString();

function anonClient(): DB {
  return createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
}
async function signedIn(email: string, pwEnv: string): Promise<DB> {
  const c = anonClient();
  const { error } = await c.auth.signInWithPassword({ email, password: process.env[pwEnv]! });
  if (error) throw new Error(`sign-in failed for ${email}`);
  return c;
}

async function makeJob(opts: { hours?: object; limit?: number; company?: string } = {}) {
  const { data, error } = await service
    .from("jobs")
    .insert({ company_id: opts.company ?? ACME, title: "Msg test role", jd_text: "test", calling_hours: opts.hours ?? ALL_HOURS, concurrency_limit: opts.limit ?? 1 })
    .select("id")
    .single();
  if (error) throw error;
  jobs.push(data.id);
  return data.id as string;
}

async function makeCall(job: string, patch: Record<string, unknown> = {}, company: string = ACME) {
  const { data: cand, error: e1 } = await service
    .from("candidates")
    .insert({ company_id: company, job_id: job, name: "Rahul Test", phone: testPhone(), source: "csv", status: "queued" })
    .select("id")
    .single();
  if (e1) throw e1;
  const { data, error } = await service
    .from("calls")
    .insert({ candidate_id: cand.id, job_id: job, company_id: company, state: "queued", due_at: soon(), ...patch })
    .select("*")
    .single();
  if (error) throw error;
  return data as { id: string; candidate_id: string; due_at: string };
}

const getCall = async (id: string) => (await service.from("calls").select("*").eq("id", id).single()).data as Record<string, unknown>;

const post = (body: unknown, from = ip()) =>
  new Request("http://localhost/api", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": from }, body: JSON.stringify(body) });

async function start(phone: string, from = ip(), job = jobId) {
  const res = await handleOtpStart(post({ job_id: job, phone }, from));
  return { status: res.status, body: (await res.json()) as Record<string, string> };
}
async function verify(phone: string, code: string, from = ip(), job = jobId) {
  const res = await handleOtpVerify(post({ job_id: job, phone, code }, from));
  return { status: res.status, body: (await res.json()) as Record<string, string> };
}

beforeAll(async () => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  if (!process.env.PICK_TIME_SECRET) process.env.PICK_TIME_SECRET = `test-${randomUUID()}-${randomUUID()}`;
  process.env.DISPATCH_SECRET = DISPATCH_SECRET;
  process.env.APP_BASE_URL = "http://localhost:3999";
  process.env.MESSAGING_PROVIDER = "log";
  await seed();
  anon = anonClient();
  acmeAdmin = await signedIn(SEED.users.acmeAdmin.email, "SEED_ACME_ADMIN_PASSWORD");
  acmeHm = await signedIn(SEED.users.acmeHm.email, "SEED_ACME_HM_PASSWORD");
  otherAdmin = await signedIn(SEED.users.otherAdmin.email, "SEED_OTHER_ADMIN_PASSWORD");
  jobId = await makeJob();
  otherJobId = await makeJob({ company: OTHER });
});

afterAll(async () => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  if (testPhones.length) await service.from("messages").delete().in("to", testPhones);
  if (jobs.length) await service.from("jobs").delete().in("id", jobs); // cascades candidates, calls, otps
});

beforeEach(() => {
  delete process.env.DISPATCH_ENABLED;
  vi.unstubAllEnvs();
});

// ---------------------------------------------------------------------------
describe("OTP start / verify", () => {
  it("rejects unknown jobs and bad numbers", async () => {
    expect((await start(testPhone(), ip(), randomUUID())).status).toBe(404);
    expect((await start("12ab", ip())).status).toBe(400);
  });

  it("sends a code (dev mode shows it), stores only a redacted body and a hash", async () => {
    const phone = testPhone();
    const r = await start(phone);
    expect(r.status).toBe(200);
    expect(r.body.verification).toBe("dev");
    expect(r.body.dev_code).toMatch(/^\d{6}$/);
    const { data: msgs } = await service.from("messages").select("*").eq("to", phone);
    expect(msgs).toHaveLength(1);
    expect(msgs![0]).toMatchObject({ kind: "otp", status: "logged", provider: "log", company_id: ACME });
    expect(msgs![0].body).not.toContain(r.body.dev_code);
    const { data: otps } = await service.from("phone_otps").select("*").eq("job_id", jobId);
    expect(JSON.stringify(otps)).not.toContain(r.body.dev_code);
  });

  it("verifies the right code once, and the token passes the apply route", async () => {
    const phone = testPhone();
    const { body } = await start(phone);
    const v = await verify(phone, body.dev_code);
    expect(v.status).toBe(200);
    expect(v.body.phone_token).toBeTruthy();
    // a used code cannot be reused
    expect((await verify(phone, body.dev_code)).status).toBe(400);

    const form = (token?: string) => {
      const fd = new FormData();
      fd.set("name", "Otp Tester");
      fd.set("phone", phone);
      fd.set("consent", "true");
      if (token) fd.set("phone_token", token);
      return new Request(`http://localhost/api/apply/${jobId}`, { method: "POST", headers: { "x-forwarded-for": ip() }, body: fd });
    };
    const ctx = { params: Promise.resolve({ jobId }) } as Parameters<typeof applyPOST>[1];
    const blocked = await applyPOST(form(), ctx);
    expect(blocked.status).toBe(400);
    expect(((await blocked.json()) as { error: string }).error).toMatch(/Verify your mobile/);
    const ok = await applyPOST(form(v.body.phone_token), ctx);
    expect(ok.status).toBe(200);
    const { data: cand } = await service.from("candidates").select("id").eq("job_id", jobId).eq("phone", phone);
    expect(cand).toHaveLength(1);
  });

  it("a token for one job does not unlock another", async () => {
    const phone = testPhone();
    const { body } = await start(phone);
    const v = await verify(phone, body.dev_code);
    const fd = new FormData();
    fd.set("name", "X");
    fd.set("phone", phone);
    fd.set("consent", "true");
    fd.set("phone_token", v.body.phone_token);
    const other = await makeJob();
    const res = await applyPOST(new Request(`http://localhost/api/apply/${other}`, { method: "POST", body: fd }), {
      params: Promise.resolve({ jobId: other }),
    } as Parameters<typeof applyPOST>[1]);
    expect(res.status).toBe(400);
  });

  it("locks after 5 wrong attempts, even for the right code", async () => {
    const phone = testPhone();
    const { body } = await start(phone);
    const wrong = body.dev_code === "000000" ? "111111" : "000000";
    const left: string[] = [];
    for (let i = 0; i < 4; i++) {
      const r = await verify(phone, wrong);
      expect(r.status).toBe(400);
      left.push(r.body.error);
    }
    expect(left[0]).toMatch(/4 tries left/);
    expect(left[3]).toMatch(/1 try left/);
    expect((await verify(phone, wrong)).status).toBe(429);
    expect((await verify(phone, body.dev_code)).status).toBe(429);
  });

  it("expires after 10 minutes", async () => {
    const phone = testPhone();
    const { body } = await start(phone);
    await service.from("phone_otps").update({ expires_at: new Date(Date.now() - 1000).toISOString() }).eq("job_id", jobId).is("verified_at", null).is("consumed_at", null);
    const r = await verify(phone, body.dev_code);
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/expired/);
  });

  it("only the newest code works", async () => {
    const phone = testPhone();
    const first = (await start(phone)).body.dev_code;
    const second = (await start(phone)).body.dev_code;
    if (first !== second) expect((await verify(phone, first)).status).toBe(400);
    expect((await verify(phone, second)).status).toBe(200);
  });

  it("rate-limits codes per phone (3 per 15 min)", async () => {
    const phone = testPhone();
    for (let i = 0; i < 3; i++) expect((await start(phone)).status).toBe(200);
    expect((await start(phone)).status).toBe(429);
  });

  it("rate-limits codes per network (10 per hour)", async () => {
    const from = ip();
    for (let i = 0; i < 10; i++) expect((await start(testPhone(), from)).status).toBe(200);
    expect((await start(testPhone(), from)).status).toBe(429);
  });

  it("rate-limits verify attempts per network (30 per hour)", async () => {
    const from = ip();
    const phone = testPhone();
    for (let i = 0; i < 30; i++) await verify(phone, "123456", from);
    expect((await verify(phone, "123456", from)).status).toBe(429);
  });

  it("production with the log provider: OTP off, no code, apply works without a token", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const phone = testPhone();
    const r = await start(phone);
    expect(r.body).toEqual({ ok: true, verification: "off" });
    const fd = new FormData();
    fd.set("name", "No Otp");
    fd.set("phone", phone);
    fd.set("consent", "true");
    const res = await applyPOST(new Request(`http://localhost/api/apply/${jobId}`, { method: "POST", headers: { "x-forwarded-for": ip() }, body: fd }), {
      params: Promise.resolve({ jobId }),
    } as Parameters<typeof applyPOST>[1]);
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
describe("heads-up sweep", () => {
  it("rejects a missing or wrong secret", async () => {
    const req = (s?: string) => new Request("http://localhost/api/messaging/sweep", { method: "POST", headers: s ? { "x-dispatch-secret": s } : {} });
    expect((await handleSweep(req())).status).toBe(401);
    expect((await handleSweep(req("nope"))).status).toBe(401);
  });

  it("sends nothing while calling is paused", async () => {
    const job = await makeJob();
    const call = await makeCall(job);
    expect(await sendHeadsUp(call.id)).toEqual({ status: "skipped", reason: "calling_paused" });
    expect(await runSweep({ jobId: job })).toMatchObject({ paused: true, checked: 0 });
  });

  it("sends exactly one heads-up per queued call, with a working pick-time link", async () => {
    process.env.DISPATCH_ENABLED = "true";
    const job = await makeJob();
    const a = await makeCall(job);
    const b = await makeCall(job);
    const later = await makeCall(job, { due_at: new Date(Date.now() + 5 * 3_600_000).toISOString() });
    const retry = await makeCall(job, { attempt: 2 });
    const r = await runSweep({ jobId: job });
    expect(r).toMatchObject({ checked: 2, logged: 2 });
    const { data: msgs } = await service.from("messages").select("*").in("call_id", [a.id, b.id, later.id, retry.id]);
    expect(msgs).toHaveLength(2);
    const m = msgs!.find((x) => x.call_id === a.id)!;
    expect(m).toMatchObject({ kind: "heads_up", status: "logged", candidate_id: a.candidate_id, company_id: ACME });
    expect(m.body).toMatch(/^Hi Rahul, this is Acme SaaS about your Msg test role application\. Aditi from our hiring team will call you shortly for a 10-minute chat\. Prefer another time\? Pick one: http:\/\/localhost:3999\/pick-time\//);
    const token = String(m.body).split("/pick-time/")[1]!;
    const v = verifyPickToken(token);
    expect(v.ok && v.value.callId).toBe(a.id);

    expect(await runSweep({ jobId: job })).toMatchObject({ checked: 0 });
    expect(await sendHeadsUp(a.id)).toEqual({ status: "skipped", reason: "already_sent" });
  });

  it("skips outside calling hours and for decided candidates", async () => {
    process.env.DISPATCH_ENABLED = "true";
    const closedHours = await makeJob({ hours: NEVER_HOURS });
    const c1 = await makeCall(closedHours);
    expect(await sendHeadsUp(c1.id)).toEqual({ status: "skipped", reason: "outside_hours" });
    const job = await makeJob();
    const c2 = await makeCall(job);
    await service.from("candidates").update({ status: "shortlisted" }).eq("id", c2.candidate_id);
    expect(await sendHeadsUp(c2.id)).toEqual({ status: "skipped", reason: "decided" });
  });
});

// ---------------------------------------------------------------------------
describe("pick-time page + booking", () => {
  it("shows 3-6 free slots inside calling hours and books one", async () => {
    const job = await makeJob({ hours: { start: "10:00", end: "19:00", days: [1, 2, 3, 4, 5, 6] } });
    const call = await makeCall(job);
    const token = signPickToken(call.id);
    const view = await loadPickView(token, ip());
    expect(view.kind).toBe("open");
    if (view.kind !== "open") return;
    expect(view.slots.length).toBeGreaterThanOrEqual(3);
    expect(view.slots.length).toBeLessThanOrEqual(6);
    expect(view.firstName).toBe("Rahul");
    expect(view.changesLeft).toBe(2);
    for (const s of view.slots) {
      const istHour = (new Date(s.iso).getUTCHours() * 60 + new Date(s.iso).getUTCMinutes() + 330) / 60 % 24;
      expect(istHour).toBeGreaterThanOrEqual(10);
      expect(istHour).toBeLessThan(19);
    }
    const r = await bookPickTime(token, view.slots[0]!.iso, ip());
    expect(r).toMatchObject({ ok: true, changesLeft: 1 });
    const row = await getCall(call.id);
    expect(new Date(String(row.due_at)).toISOString()).toBe(new Date(view.slots[0]!.iso).toISOString());
    expect(row).toMatchObject({ reschedule_count: 1, scheduled: true, state: "queued" });
  });

  it("allows at most 2 moves", async () => {
    const job = await makeJob();
    const call = await makeCall(job);
    const token = signPickToken(call.id);
    for (let i = 0; i < 2; i++) {
      const v = await loadPickView(token, ip());
      if (v.kind !== "open") throw new Error(`expected open, got ${v.kind}`);
      expect((await bookPickTime(token, v.slots[1]!.iso, ip())).ok).toBe(true);
    }
    expect((await loadPickView(token, ip())).kind).toBe("limit");
    const again = await bookPickTime(token, new Date(Date.now() + 86_400_000).toISOString(), ip());
    expect(again).toMatchObject({ ok: false, status: 409 });
    expect((await getCall(call.id)).reschedule_count).toBe(2);
  });

  it("never offers or books a full slot (job line limit)", async () => {
    const job = await makeJob({ limit: 1 });
    const call = await makeCall(job);
    const token = signPickToken(call.id);
    const v1 = await loadPickView(token, ip());
    if (v1.kind !== "open") throw new Error("expected open");
    const full = v1.slots[0]!.iso;
    await makeCall(job, { due_at: full }); // fills that window
    const v2 = await loadPickView(token, ip());
    if (v2.kind !== "open") throw new Error("expected open");
    expect(v2.slots.map((s) => s.iso)).not.toContain(full);
    expect(await bookPickTime(token, full, ip())).toMatchObject({ ok: false, status: 409 });
  });

  it("rejects off-grid times, tampered and expired links, and calls no longer queued", async () => {
    const job = await makeJob();
    const call = await makeCall(job);
    const token = signPickToken(call.id);
    expect(await bookPickTime(token, "2020-01-01T00:00:00Z", ip())).toMatchObject({ ok: false, status: 400 });
    expect(await bookPickTime(token, "not a date", ip())).toMatchObject({ ok: false, status: 400 });
    const tampered = token.slice(0, 10) + (token[10] === "A" ? "B" : "A") + token.slice(11);
    expect(await bookPickTime(tampered, "x", ip())).toMatchObject({ ok: false, status: 404 });
    expect((await loadPickView(tampered, ip())).kind).toBe("invalid");
    const old = signPickToken(call.id, new Date(Date.now() - 4 * 86_400_000));
    expect(await bookPickTime(old, "x", ip())).toMatchObject({ ok: false, status: 410 });
    expect((await loadPickView(old, ip())).kind).toBe("expired");
    await service.from("calls").update({ state: "finished", outcome: "completed" }).eq("id", call.id);
    expect((await loadPickView(token, ip())).kind).toBe("closed");
    expect(await bookPickTime(token, new Date().toISOString(), ip())).toMatchObject({ ok: false, status: 409 });
  });

  it("rate-limits booking per link and per network", async () => {
    const job = await makeJob();
    const call = await makeCall(job);
    const token = signPickToken(call.id);
    const codes: number[] = [];
    for (let i = 0; i < 7; i++) {
      const r = await bookPickTime(token, "2020-01-01T00:00:00Z", ip());
      codes.push(r.ok ? 200 : r.status);
    }
    expect(codes.slice(0, 6).every((c) => c === 400)).toBe(true);
    expect(codes[6]).toBe(429);
    const from = ip();
    const other = signPickToken((await makeCall(job)).id);
    let last = 0;
    for (let i = 0; i < 11; i++) {
      const r = await bookPickTime(i % 2 ? other : signPickToken(randomUUID()), "x", from);
      last = r.ok ? 200 : r.status;
    }
    expect(last).toBe(429);
  });
});

// ---------------------------------------------------------------------------
describe("admin message log (per role)", () => {
  let acmeMsgPhone = "";
  let otherMsgPhone = "";
  beforeAll(async () => {
    process.env.DISPATCH_ENABLED = "true";
    const a = await makeCall(jobId);
    const o = await makeCall(otherJobId, {}, OTHER);
    expect((await sendHeadsUp(a.id)).status).toBe("logged");
    expect((await sendHeadsUp(o.id)).status).toBe("logged");
    acmeMsgPhone = String((await service.from("candidates").select("phone").eq("id", a.candidate_id).single()).data!.phone);
    otherMsgPhone = String((await service.from("candidates").select("phone").eq("id", o.candidate_id).single()).data!.phone);
    delete process.env.DISPATCH_ENABLED;
  });
  const list = async (c: DB) => {
    as(c);
    const res = await handleListMessages(new Request("http://localhost/api/messaging/messages?limit=100"));
    return { status: res.status, body: (await res.json()) as { messages?: { to: string; body: string }[]; status?: { otp: string; notices: string[] } } };
  };

  it("unauthenticated is rejected", async () => {
    expect((await list(anon)).status).toBe(401);
  });

  it("hiring manager is refused (and RLS returns no rows)", async () => {
    expect((await list(acmeHm)).status).toBe(403);
    const { data } = await acmeHm.from("messages").select("*");
    expect(data ?? []).toHaveLength(0);
  });

  it("admin sees own company only, with masked numbers and links", async () => {
    const r = await list(acmeAdmin);
    expect(r.status).toBe(200);
    const all = JSON.stringify(r.body.messages);
    expect(all).not.toContain(acmeMsgPhone);
    expect(r.body.messages!.some((m) => m.body.includes("/pick-time/•••"))).toBe(true);
    expect(r.body.status?.otp).toBe("dev");
    const { data } = await acmeAdmin.from("messages").select("company_id, to");
    expect(data!.length).toBeGreaterThan(0);
    expect(data!.every((m) => m.company_id === ACME)).toBe(true);
    expect(data!.some((m) => m.to === otherMsgPhone)).toBe(false);
  });

  it("other company's admin never sees Acme messages", async () => {
    const r = await list(otherAdmin);
    expect(r.status).toBe(200);
    const { data } = await otherAdmin.from("messages").select("company_id, to");
    expect(data!.every((m) => m.company_id === OTHER)).toBe(true);
    expect(data!.some((m) => m.to === acmeMsgPhone)).toBe(false);
  });

  it("clients cannot write messages or read OTP / rate-limit tables", async () => {
    const ins = await acmeAdmin.from("messages").insert({ company_id: ACME, channel: "sms", to: "+15550100000", body: "x", provider: "log" });
    expect(ins.error).toBeTruthy();
    const upd = await acmeAdmin.from("messages").update({ body: "changed" }).eq("company_id", ACME).select("id");
    expect(upd.error || (upd.data ?? []).length === 0).toBeTruthy();
    for (const c of [anon, acmeAdmin, acmeHm]) {
      for (const t of ["phone_otps", "messaging_rate_limits"]) {
        const { data } = await c.from(t).select("*");
        expect(data ?? []).toHaveLength(0);
      }
      const rpc = await c.rpc("verify_phone_otp", { p_phone_hash: "x", p_job_id: jobId, p_code_hash: "y" });
      expect(rpc.error).toBeTruthy();
    }
    const { data: anonMsgs } = await anon.from("messages").select("*");
    expect(anonMsgs ?? []).toHaveLength(0);
  });
});
