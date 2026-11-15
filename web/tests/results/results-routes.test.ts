/**
 * Per-role tests for the results routes (M7), against the LIVE Supabase project like
 * tests/jobs-routes.test.ts. Needs web/.env.local; seed() runs first.
 *
 * Route handlers run for real; only "who is signed in" is swapped (the server Supabase client
 * becomes a client signed in as the test user, so RLS applies exactly as in the browser).
 * Throwaway Acme jobs, candidates, calls and scores are created and removed.
 */
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SEED, adminClient, seed } from "../../scripts/seed";

const h = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("server-only", () => ({}));
vi.mock("../../lib/supabase/server", () => ({
  createClient: async () => h.client,
  getUserClaims: async () => null,
}));

import * as candidateRoute from "../../app/api/candidates/[id]/route";
import * as actionsRoute from "../../app/api/candidates/[id]/actions/route";
import * as rankingRoute from "../../app/api/jobs/[id]/ranking/route";
import * as exportRoute from "../../app/api/jobs/[id]/export/route";
import * as poolRoute from "../../app/api/talent-pool/route";
import * as statusRoute from "../../app/api/settings/status/route";
import * as cancelRoute from "../../app/api/batches/[id]/cancel/route";

type DB = SupabaseClient;
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const ACME = SEED.acme.id;
const service = adminClient() as unknown as DB;

let anon: DB, acmeAdmin: DB, acmeHm: DB, otherAdmin: DB, recruiter: DB;
let recruiterId = "";
let jobId = "";
let job2Id = "";
let star = ""; // scored, strong
let hidden = ""; // scored, culture standout + fits another role
let waiting = ""; // queued in a batch
let batchId = "";
const createdJobs: string[] = [];

const as = (c: DB) => {
  h.client = c;
};
const anonClient = (): DB => createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
async function signIn(email: string, password: string): Promise<DB> {
  const c = anonClient();
  const { error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`sign-in failed for ${email}`);
  return c;
}
const get = (url = "http://localhost/api") => new Request(url);
const post = (body?: unknown) =>
  new Request("http://localhost/api", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const phone = () => `+9198${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;

const q = (skills: number, experience: number, extra: Record<string, number> = {}) => {
  const out: Record<string, { score: number; quotes: { text: string; ts: number }[]; reason: string }> = {};
  for (const [k, v] of Object.entries({ skills, experience, ...extra })) out[k] = { score: v, quotes: [{ text: `quote for ${k}`, ts: 12 }], reason: `reason ${k}` };
  return out;
};

async function addScored(name: string, qualities: ReturnType<typeof q>, flags: Record<string, unknown>) {
  const c = await service
    .from("candidates")
    .insert({ company_id: ACME, job_id: jobId, name, phone: phone(), source: "csv", status: "scored", resume_only_score: 40 })
    .select("id")
    .single();
  if (c.error) throw c.error;
  const id = (c.data as { id: string }).id;
  const call = await service
    .from("calls")
    .insert({ candidate_id: id, job_id: jobId, company_id: ACME, state: "finished", outcome: "completed", duration_s: 420, transcript: "assistant: Hi\nuser: quote for skills" })
    .select("id")
    .single();
  if (call.error) throw call.error;
  const s = await service.from("scores").insert({
    call_id: (call.data as { id: string }).id,
    candidate_id: id,
    company_id: ACME,
    rubric_version: 1,
    qualities,
    must_have_results: [{ text: "Fluent spoken English", met: true, quote: "yes" }],
    flags: { other_role: null, culture_standout: false, wants_internship: false, resume_mismatch: [], hr_review: null, ...flags },
    summary: `${name} summary.`,
  });
  if (s.error) throw s.error;
  return id;
}

beforeAll(async () => {
  await seed();
  anon = anonClient();
  acmeAdmin = await signIn(SEED.users.acmeAdmin.email, process.env[SEED.users.acmeAdmin.passwordEnv]!);
  acmeHm = await signIn(SEED.users.acmeHm.email, process.env[SEED.users.acmeHm.passwordEnv]!);
  otherAdmin = await signIn(SEED.users.otherAdmin.email, process.env[SEED.users.otherAdmin.passwordEnv]!);

  const email = `recruiter-${randomBytes(4).toString("hex")}@acme.pingo.test`;
  const password = randomBytes(18).toString("base64url");
  const u = await service.auth.admin.createUser({ email, password, email_confirm: true });
  if (u.error || !u.data.user) throw u.error ?? new Error("could not create recruiter");
  recruiterId = u.data.user.id;
  const m = await service.from("members").insert({ user_id: recruiterId, company_id: ACME, role: "recruiter" });
  if (m.error) throw m.error;
  recruiter = await signIn(email, password);

  const jobs = await service
    .from("jobs")
    .insert([
      { company_id: ACME, title: "M7 test job", jd_text: "Sell things." },
      { company_id: ACME, title: "M7 other role", jd_text: "Support customers." },
    ])
    .select("id, title");
  if (jobs.error) throw jobs.error;
  const rows = jobs.data as { id: string; title: string }[];
  jobId = rows.find((j) => j.title === "M7 test job")!.id;
  job2Id = rows.find((j) => j.title === "M7 other role")!.id;
  createdJobs.push(jobId, job2Id);
  const r = await service.from("rubrics").insert({ job_id: jobId, company_id: ACME, version: 1, weights: { skills: 50, experience: 50 }, is_current: true });
  if (r.error) throw r.error;

  star = await addScored("M7 Star", q(5, 4), {});
  hidden = await addScored("M7 Hidden", q(2, 2), { culture_standout: true, other_role: { job_id: job2Id, reason: "Great with customers" } });

  const w = await service
    .from("candidates")
    .insert({ company_id: ACME, job_id: jobId, name: "M7 Waiting", phone: phone(), source: "csv", status: "queued" })
    .select("id")
    .single();
  if (w.error) throw w.error;
  waiting = (w.data as { id: string }).id;
  const b = await service.from("batches").insert({ job_id: jobId, company_id: ACME, total: 1, status: "queued" }).select("id").single();
  if (b.error) throw b.error;
  batchId = (b.data as { id: string }).id;
  const qc = await service.from("calls").insert({
    candidate_id: waiting,
    job_id: jobId,
    company_id: ACME,
    batch_id: batchId,
    state: "queued",
    due_at: new Date(Date.now() + 3_600_000).toISOString(),
  });
  if (qc.error) throw qc.error;
});

afterAll(async () => {
  if (createdJobs.length) await service.from("jobs").delete().in("id", createdJobs); // cascades everything below
  if (recruiterId) await service.auth.admin.deleteUser(recruiterId);
});

// ---------------------------------------------------------------------------
describe("GET /api/candidates/:id", () => {
  it("rejects unauthenticated with 401", async () => {
    as(anon);
    expect((await candidateRoute.GET(get(), ctx(star))).status).toBe(401);
  });
  it("hides an Acme candidate from another company (404)", async () => {
    as(otherAdmin);
    const res = await candidateRoute.GET(get(), ctx(star));
    expect(res.status).toBe(404);
    expect(JSON.stringify(await res.json())).not.toContain("M7 Star");
  });
  it("lets the hiring manager read the full profile", async () => {
    as(acmeHm);
    const res = await candidateRoute.GET(get(), ctx(star));
    expect(res.status).toBe(200);
    const d = await res.json();
    expect(d.candidate.name).toBe("M7 Star");
    expect(d.overall).toBe(88); // skills 5 + experience 4 at 50/50 -> 4.5 -> 87.5
  });
  it("404s on a malformed id", async () => {
    as(acmeAdmin);
    expect((await candidateRoute.GET(get(), ctx("not-a-uuid"))).status).toBe(404);
  });
});

describe("GET /api/jobs/:id/ranking", () => {
  it("rejects unauthenticated with 401", async () => {
    as(anon);
    expect((await rankingRoute.GET(get(), ctx(jobId))).status).toBe(401);
  });
  it("hides the job from another company (404)", async () => {
    as(otherAdmin);
    expect((await rankingRoute.GET(get(), ctx(jobId))).status).toBe(404);
  });
  it("ranks for the hiring manager, best first", async () => {
    as(acmeHm);
    const res = await rankingRoute.GET(get(), ctx(jobId));
    expect(res.status).toBe(200);
    const d = (await res.json()) as { rows: { candidate: { name: string }; pick: string | null }[] };
    expect(d.rows[0].candidate.name).toBe("M7 Star");
    expect(d.rows[0].pick).toBe("amazing");
    expect(d.rows.map((r) => r.candidate.name)).toContain("M7 Hidden");
  });
  it("400s on a bad rubric_version and 404s on a missing one", async () => {
    as(acmeAdmin);
    expect((await rankingRoute.GET(get("http://localhost/api?rubric_version=x"), ctx(jobId))).status).toBe(400);
    expect((await rankingRoute.GET(get("http://localhost/api?rubric_version=99"), ctx(jobId))).status).toBe(404);
  });
});

describe("GET /api/jobs/:id/export", () => {
  it("rejects unauthenticated with 401", async () => {
    as(anon);
    expect((await exportRoute.GET(get(), ctx(jobId))).status).toBe(401);
  });
  it("hides another company's export (404)", async () => {
    as(otherAdmin);
    expect((await exportRoute.GET(get(), ctx(jobId))).status).toBe(404);
  });
  it("forbids the hiring manager (403)", async () => {
    as(acmeHm);
    expect((await exportRoute.GET(get(), ctx(jobId))).status).toBe(403);
  });
  it("gives the admin a CSV, ranked", async () => {
    as(acmeAdmin);
    const res = await exportRoute.GET(get(), ctx(jobId));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    const text = await res.text();
    const lines = text.trim().split(/\r\n/);
    expect(lines[0]).toContain("Name");
    expect(lines[1]).toContain("M7 Star");
  });
});

describe("GET /api/talent-pool", () => {
  it("rejects unauthenticated with 401", async () => {
    as(anon);
    expect((await poolRoute.GET(get())).status).toBe(401);
  });
  it("never shows Acme people to another company", async () => {
    as(otherAdmin);
    const res = await poolRoute.GET(get());
    expect(res.status).toBe(200);
    expect(JSON.stringify(await res.json())).not.toContain("M7 Hidden");
  });
  it("lists flagged people across Acme jobs for the hiring manager", async () => {
    as(acmeHm);
    const res = await poolRoute.GET(get("http://localhost/api?flag=culture_standout"));
    const d = (await res.json()) as { rows: { candidate: { name: string }; other_role: { job_id: string } | null }[] };
    const row = d.rows.find((r) => r.candidate.name === "M7 Hidden");
    expect(row).toBeTruthy();
    expect(row?.other_role?.job_id).toBe(job2Id);
  });
  it("400s on an unknown flag", async () => {
    as(acmeAdmin);
    expect((await poolRoute.GET(get("http://localhost/api?flag=nope"))).status).toBe(400);
  });
});

describe("POST /api/candidates/:id/actions", () => {
  it("rejects unauthenticated with 401", async () => {
    as(anon);
    expect((await actionsRoute.POST(post({ type: "note", note: "hi" }), ctx(star))).status).toBe(401);
  });
  it("hides the candidate from another company (404) and writes nothing", async () => {
    as(otherAdmin);
    expect((await actionsRoute.POST(post({ type: "note", note: "cross" }), ctx(star))).status).toBe(404);
    const { count } = await service.from("actions").select("id", { count: "exact", head: true }).eq("candidate_id", star).eq("note", "cross");
    expect(count).toBe(0);
  });
  it("lets the hiring manager add a note", async () => {
    as(acmeHm);
    const res = await actionsRoute.POST(post({ type: "note", note: "Strong on discovery" }), ctx(star));
    expect(res.status).toBe(201);
  });
  it("forbids the hiring manager from shortlisting, rejecting, overriding or moving (403)", async () => {
    as(acmeHm);
    for (const body of [
      { type: "shortlist" },
      { type: "reject" },
      { type: "override", new_value: { pick: "no" } },
      { type: "move_to_job", target_job_id: job2Id },
    ]) {
      expect((await actionsRoute.POST(post(body), ctx(star))).status).toBe(403);
    }
    const { data } = await service.from("candidates").select("status").eq("id", star).single();
    expect((data as { status: string }).status).toBe("scored");
  });
  it("400s on a bad body", async () => {
    as(recruiter);
    expect((await actionsRoute.POST(post({ type: "override", new_value: { pick: "superb" } }), ctx(star))).status).toBe(400);
    expect((await actionsRoute.POST(post({ type: "note", note: "  " }), ctx(star))).status).toBe(400);
  });
  it("lets a recruiter shortlist and undo, with an audit row each time", async () => {
    as(recruiter);
    expect((await actionsRoute.POST(post({ type: "shortlist" }), ctx(star))).status).toBe(201);
    let { data } = await service.from("candidates").select("status").eq("id", star).single();
    expect((data as { status: string }).status).toBe("shortlisted");
    expect((await actionsRoute.POST(post({ type: "shortlist", new_value: { undo: true } }), ctx(star))).status).toBe(201);
    ({ data } = await service.from("candidates").select("status").eq("id", star).single());
    expect((data as { status: string }).status).toBe("scored");
    const { count } = await service.from("actions").select("id", { count: "exact", head: true }).eq("candidate_id", star).eq("type", "shortlist");
    expect(count).toBe(2);
  });
  it("keeps a recruiter's override after a re-score", async () => {
    as(recruiter);
    const res = await actionsRoute.POST(post({ type: "override", new_value: { pick: "maybe" }, note: "Want a second call" }), ctx(star));
    expect(res.status).toBe(201);

    // re-score: a newer score row for the same candidate
    const { data: call } = await service.from("calls").select("id").eq("candidate_id", star).limit(1).single();
    const s = await service.from("scores").insert({
      call_id: (call as { id: string }).id,
      candidate_id: star,
      company_id: ACME,
      rubric_version: 1,
      qualities: q(5, 5),
      must_have_results: [],
      flags: { other_role: null, culture_standout: false, wants_internship: false, resume_mismatch: [], hr_review: null },
      summary: "Re-scored.",
    });
    expect(s.error).toBeNull();

    as(acmeHm);
    const d = await (await candidateRoute.GET(get(), ctx(star))).json();
    expect(d.score.summary).toBe("Re-scored.");
    expect(d.scored_pick).toBe("amazing");
    expect(d.pick).toBe("maybe");
    expect(d.override.pick).toBe("maybe");

    as(recruiter);
    expect((await actionsRoute.POST(post({ type: "override", new_value: { pick: null } }), ctx(star))).status).toBe(201);
    const d2 = await (await candidateRoute.GET(get(), ctx(star))).json();
    expect(d2.pick).toBe("amazing");
    expect(d2.override).toBeNull();
  });
  it("lets a recruiter move a hidden fit to another job's shortlist", async () => {
    as(recruiter);
    const res = await actionsRoute.POST(post({ type: "move_to_job", target_job_id: job2Id }), ctx(hidden));
    expect(res.status).toBe(201);
    const { data } = await service.from("candidates").select("status, name").eq("job_id", job2Id);
    expect(data).toEqual([{ status: "shortlisted", name: "M7 Hidden" }]);
    // moving again is idempotent (no duplicate row)
    expect((await actionsRoute.POST(post({ type: "move_to_job", target_job_id: job2Id }), ctx(hidden))).status).toBe(201);
    const { count } = await service.from("candidates").select("id", { count: "exact", head: true }).eq("job_id", job2Id);
    expect(count).toBe(1);
  });
  it("refuses a move to another company's job (404)", async () => {
    as(recruiter);
    expect((await actionsRoute.POST(post({ type: "move_to_job", target_job_id: SEED.otherJobId }), ctx(hidden))).status).toBe(404);
  });
});

describe("GET /api/settings/status", () => {
  it("rejects unauthenticated with 401", async () => {
    as(anon);
    expect((await statusRoute.GET()).status).toBe(401);
  });
  it("tells any member whether calling is paused, without secrets", async () => {
    as(acmeHm);
    const res = await statusRoute.GET();
    expect(res.status).toBe(200);
    const d = await res.json();
    expect(typeof d.calling_paused).toBe("boolean");
    expect(d.message).toMatch(/^Calling is (paused|on)$/);
    expect(JSON.stringify(d)).not.toMatch(/key|secret/i);
  });
});

describe("POST /api/batches/:id/cancel", () => {
  it("rejects unauthenticated with 401", async () => {
    as(anon);
    expect((await cancelRoute.POST(post(), ctx(batchId))).status).toBe(401);
  });
  it("hides the batch from another company (404)", async () => {
    as(otherAdmin);
    expect((await cancelRoute.POST(post(), ctx(batchId))).status).toBe(404);
  });
  it("forbids the hiring manager (403) and leaves the queue alone", async () => {
    as(acmeHm);
    expect((await cancelRoute.POST(post(), ctx(batchId))).status).toBe(403);
    const { count } = await service.from("calls").select("id", { count: "exact", head: true }).eq("batch_id", batchId).eq("state", "queued");
    expect(count).toBe(1);
  });
  it("lets a recruiter stop the batch: queued calls removed, candidate back to imported", async () => {
    as(recruiter);
    const res = await cancelRoute.POST(post(), ctx(batchId));
    expect(res.status).toBe(200);
    expect((await res.json()).cancelled).toBe(1);
    const { count } = await service.from("calls").select("id", { count: "exact", head: true }).eq("batch_id", batchId);
    expect(count).toBe(0);
    const { data: c } = await service.from("candidates").select("status").eq("id", waiting).single();
    expect((c as { status: string }).status).toBe("imported");
    const { data: b } = await service.from("batches").select("status").eq("id", batchId).single();
    expect((b as { status: string }).status).toBe("stopped");
  });
});
