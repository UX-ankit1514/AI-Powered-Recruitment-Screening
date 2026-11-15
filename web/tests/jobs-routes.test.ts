/**
 * Per-role route tests for the job + rubric routes (M5), against the LIVE Supabase project
 * like tests/rls.test.ts. Needs web/.env.local; seed() runs first.
 *
 * Route handlers run for real. Only "who is signed in" is swapped: the server Supabase client
 * becomes a client signed in as the test user (anon key + session), so RLS applies exactly as
 * in the browser. Writes go to a throwaway Acme job; a throwaway recruiter is created and removed.
 */
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SEED, adminClient, seed } from "../scripts/seed";

const h = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("server-only", () => ({}));
vi.mock("../lib/supabase/server", () => ({
  createClient: async () => h.client,
  getUserClaims: async () => null,
}));
vi.mock("../lib/ai", () => ({
  AiError: class AiError extends Error {
    kind = "http";
  },
  draftRubric: vi.fn(async () => ({
    must_haves: ["Fluent spoken English"],
    nice_to_haves: ["CRM experience"],
    suggested_traits: [{ key: "resilience", name: "Resilience", description: "Keeps going after a no" }],
    model_version: "test",
    prompt_version: "test",
  })),
}));

import * as jobsRoute from "../app/api/jobs/route";
import * as jobRoute from "../app/api/jobs/[id]/route";
import * as rubricRoute from "../app/api/jobs/[id]/rubric/route";
import * as draftRoute from "../app/api/jobs/[id]/rubric/draft/route";

type DB = SupabaseClient;
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const ACME = SEED.acme.id;
const service = adminClient() as unknown as DB;

let anon: DB, acmeAdmin: DB, acmeHm: DB, otherAdmin: DB, recruiter: DB;
let recruiterId = "";
let jobId = "";
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
const req = (method: string, body?: unknown) =>
  new Request("http://localhost/api", {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

const goodRubric = {
  must_haves: [{ text: "Fluent spoken English and Hindi" }],
  nice_to_haves: [],
  weights: { skills: 40, experience: 30, culture_fit: 20, t_grit: 10 },
  custom_traits: [{ key: "t_grit", name: "Grit", description: "Keeps going" }],
};

async function rubricsOf(job: string) {
  const { data } = await service.from("rubrics").select("version, is_current, weights").eq("job_id", job).order("version");
  return (data ?? []) as { version: number; is_current: boolean; weights: Record<string, number> }[];
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

  const j = await service.from("jobs").insert({ company_id: ACME, title: "M5 test job", jd_text: "Sell things." }).select("id").single();
  if (j.error) throw j.error;
  jobId = (j.data as { id: string }).id;
  createdJobs.push(jobId);
  const r = await service
    .from("rubrics")
    .insert({ job_id: jobId, company_id: ACME, version: 1, weights: { skills: 50, experience: 50 }, is_current: true });
  if (r.error) throw r.error;
});

afterAll(async () => {
  if (createdJobs.length) await service.from("jobs").delete().in("id", createdJobs); // cascades rubrics
  await service.from("jobs").delete().eq("company_id", ACME).like("title", "M5 created %");
  if (recruiterId) await service.auth.admin.deleteUser(recruiterId); // cascades membership
});

// ---------------------------------------------------------------------------
describe("PUT /api/jobs/:id", () => {
  it("rejects unauthenticated with 401", async () => {
    as(anon);
    const res = await jobRoute.PUT(req("PUT", { title: "x" }), ctx(jobId));
    expect(res.status).toBe(401);
  });

  it("forbids the hiring manager (403) and leaves the job unchanged", async () => {
    as(acmeHm);
    const res = await jobRoute.PUT(req("PUT", { title: "HM edit" }), ctx(jobId));
    expect(res.status).toBe(403);
    const { data } = await service.from("jobs").select("title").eq("id", jobId).single();
    expect((data as { title: string }).title).toBe("M5 test job");
  });

  it("hides another company's job (404) and leaves it unchanged", async () => {
    as(otherAdmin);
    const res = await jobRoute.PUT(req("PUT", { title: "Other edit" }), ctx(jobId));
    expect(res.status).toBe(404);
    as(acmeAdmin);
    const res2 = await jobRoute.PUT(req("PUT", { title: "Cross edit" }), ctx(SEED.otherJobId));
    expect(res2.status).toBe(404);
  });

  it("lets a recruiter update every setup field", async () => {
    as(recruiter);
    const body = {
      title: "M5 test job",
      jd_text: "Sell workflow software.",
      culture_values: [{ name: "Ownership", description: "End to end" }],
      faq: [{ question: "Remote?", answer: "Hybrid." }],
      calling_hours: { start: "09:30", end: "18:00", days: [5, 1, 1, 2] },
      languages: ["en", "hinglish"],
      ats_mode: "ats_filter",
      ats_top_pct: 40,
      ats_rescue: false,
    };
    const res = await jobRoute.PUT(req("PUT", body), ctx(jobId));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { job: Record<string, unknown> };
    expect(json.job.ats_mode).toBe("ats_filter");
    expect(json.job.calling_hours).toEqual({ start: "09:30", end: "18:00", days: [1, 2, 5] });
  });

  it("lets an admin update", async () => {
    as(acmeAdmin);
    const res = await jobRoute.PUT(req("PUT", { ats_mode: "call_everyone" }), ctx(jobId));
    expect(res.status).toBe(200);
  });

  it("validates the body (400)", async () => {
    as(recruiter);
    for (const bad of [
      { languages: ["ta"] }, // not enabled yet
      { languages: [] },
      { ats_top_pct: 5 },
      { calling_hours: { start: "19:00", end: "10:00", days: [1] } },
      { company_id: SEED.other.id }, // unknown keys are rejected, never written
      {},
    ]) {
      const res = await jobRoute.PUT(req("PUT", bad), ctx(jobId));
      expect(res.status, JSON.stringify(bad)).toBe(400);
    }
    const res = await jobRoute.PUT(req("PUT", "{not json"), ctx(jobId));
    expect(res.status).toBe(400);
  });

  it("returns 404 for a malformed id", async () => {
    as(recruiter);
    const res = await jobRoute.PUT(req("PUT", { title: "x" }), ctx("not-a-uuid"));
    expect(res.status).toBe(404);
  });
});

describe("PUT /api/jobs/:id/rubric", () => {
  it("rejects unauthenticated with 401", async () => {
    as(anon);
    expect((await rubricRoute.PUT(req("PUT", goodRubric), ctx(jobId))).status).toBe(401);
  });

  it("forbids the hiring manager (403) and creates no version", async () => {
    as(acmeHm);
    expect((await rubricRoute.PUT(req("PUT", goodRubric), ctx(jobId))).status).toBe(403);
    expect((await rubricsOf(jobId)).map((r) => r.version)).toEqual([1]);
  });

  it("hides another company's job (404)", async () => {
    as(otherAdmin);
    expect((await rubricRoute.PUT(req("PUT", goodRubric), ctx(jobId))).status).toBe(404);
    expect((await rubricsOf(jobId)).map((r) => r.version)).toEqual([1]);
  });

  it("recruiter saves a new current version; the old one is retired", async () => {
    as(recruiter);
    const res = await rubricRoute.PUT(req("PUT", goodRubric), ctx(jobId));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { rubric: { version: number; is_current: boolean } };
    expect(json.rubric).toMatchObject({ version: 2, is_current: true });
    const rows = await rubricsOf(jobId);
    expect(rows.map((r) => [r.version, r.is_current])).toEqual([
      [1, false],
      [2, true],
    ]);
    expect(rows[1].weights).toEqual(goodRubric.weights);
  });

  it("admin saves the next version", async () => {
    as(acmeAdmin);
    const res = await rubricRoute.PUT(req("PUT", { ...goodRubric, weights: { skills: 100 }, custom_traits: [] }), ctx(jobId));
    expect(res.status).toBe(200);
    const rows = await rubricsOf(jobId);
    expect(rows.filter((r) => r.is_current).map((r) => r.version)).toEqual([3]);
  });

  it("validates the body (400)", async () => {
    as(recruiter);
    for (const bad of [
      { ...goodRubric, weights: { skills: 0 } }, // nothing to rank on
      { ...goodRubric, weights: { made_up: 50 } }, // unknown quality
      { ...goodRubric, custom_traits: [{ key: "skills", name: "Skills 2" }] }, // shadows a built-in
      { ...goodRubric, weights: { skills: 150 } },
      { ...goodRubric, must_haves: [{ text: "A" }, { text: "a" }] },
      { ...goodRubric, is_current: false },
    ]) {
      const res = await rubricRoute.PUT(req("PUT", bad), ctx(jobId));
      expect(res.status, JSON.stringify(bad)).toBe(400);
    }
    expect((await rubricsOf(jobId)).length).toBe(3);
  });
});

describe("POST /api/jobs", () => {
  it("rejects unauthenticated with 401", async () => {
    as(anon);
    expect((await jobsRoute.POST(req("POST", { title: "M5 created anon" }))).status).toBe(401);
  });

  it("forbids the hiring manager (403)", async () => {
    as(acmeHm);
    expect((await jobsRoute.POST(req("POST", { title: "M5 created hm" }))).status).toBe(403);
  });

  it("recruiter creates a job in their own company with rubric v1", async () => {
    as(recruiter);
    const res = await jobsRoute.POST(req("POST", { title: "M5 created recruiter", jd_text: "Hello" }));
    expect(res.status).toBe(201);
    const { job } = (await res.json()) as { job: { id: string; company_id: string } };
    createdJobs.push(job.id);
    expect(job.company_id).toBe(ACME);
    expect((await rubricsOf(job.id)).map((r) => [r.version, r.is_current])).toEqual([[1, true]]);
  });

  it("ignores attempts to pick another company (400 on unknown keys)", async () => {
    as(recruiter);
    const res = await jobsRoute.POST(req("POST", { title: "M5 created x", company_id: SEED.other.id }));
    expect(res.status).toBe(400);
  });
});

describe("POST /api/jobs/:id/rubric/draft", () => {
  it("rejects unauthenticated with 401", async () => {
    as(anon);
    expect((await draftRoute.POST(req("POST", {}), ctx(jobId))).status).toBe(401);
  });
  it("forbids the hiring manager (403)", async () => {
    as(acmeHm);
    expect((await draftRoute.POST(req("POST", {}), ctx(jobId))).status).toBe(403);
  });
  it("hides another company's job (404)", async () => {
    as(otherAdmin);
    expect((await draftRoute.POST(req("POST", {}), ctx(jobId))).status).toBe(404);
  });
  it("returns a draft for a recruiter without saving it", async () => {
    as(recruiter);
    const before = (await rubricsOf(jobId)).length;
    const res = await draftRoute.POST(req("POST", {}), ctx(jobId));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { must_haves: string[]; suggested_traits: unknown[] };
    expect(json.must_haves).toEqual(["Fluent spoken English"]);
    expect(json.suggested_traits).toHaveLength(1);
    expect((await rubricsOf(jobId)).length).toBe(before);
  });
});
