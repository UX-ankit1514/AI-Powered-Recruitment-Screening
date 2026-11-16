/**
 * M9: per-role access matrix for EVERY route handler under app/api (live Supabase, real RLS).
 *
 * For each route + method:
 *   - unauthenticated (no session / no secret)  -> 401
 *   - Acme hiring manager                         -> read routes 200, write routes 403 (notes allowed)
 *   - Other Co admin                              -> 404 on Acme resources (never a hint they exist)
 *   - Acme recruiter                              -> read routes 200 (writes are covered in the module tests)
 * A coverage test walks app/api/** and fails if any exported handler is missing from the matrix,
 * so a new route cannot ship without its role tests.
 */
import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ACME, OTHER, castOfUsers, cleanupCast, dropJobs, jsonReq, makeFixture, service, type Cast, type DB } from "./helpers";

const h = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("server-only", () => ({}));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => undefined }));
vi.mock("../../lib/supabase/server", () => ({
  createClient: async () => h.client,
  getUserClaims: async () => null,
}));
vi.mock("../../lib/supabase/admin", async () => {
  const { adminClient } = await import("../../scripts/seed");
  return { createAdminClient: () => adminClient() };
});
vi.mock("../../lib/ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/ai")>()),
  draftRubric: vi.fn(async () => ({ must_haves: ["x"], nice_to_haves: [], suggested_traits: [], model_version: "t", prompt_version: "t" })),
  scoreCall: vi.fn(async () => {
    throw new Error("not used");
  }),
}));

type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
type Mod = Record<string, Handler>;

const API_DIR = join(__dirname, "../../app/api");
const ROUTE_MODULES = import.meta.glob<Mod>("../../app/api/**/route.ts");

let cast: Cast;
let fx: { jobId: string; candidateId: string; batchId: string };
let eraseCandidateId = ""; // a second candidate the admin is allowed to erase
const savedRetention: Record<string, { retention_recording_days: number; retention_transcript_days: number; concurrency_limit: number | null }> = {};
const jobs: string[] = [];
const as = (c: DB | null) => {
  h.client = c;
};

type Who = "anon" | "hm" | "other" | "recruiter" | "admin";
type Expect = Partial<Record<Who, number | number[]>>;
type Case = {
  route: string; // path relative to app/api, e.g. "jobs/[id]/rubric"
  method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  params?: () => Record<string, string>;
  body?: () => unknown;
  url?: () => string;
  expect: Expect;
  /** Secret-authenticated machine route: only the "no secret" case applies. */
  machine?: boolean;
  /** Public route: documented, tested in tests/ingest (rate limit, no data returned). */
  public?: boolean;
};

const WRITE: Expect = { anon: 401, hm: 403, other: 404 };
const READ: Expect = { anon: 401, hm: 200, other: 404, recruiter: 200 };
const goodRubric = { must_haves: [{ text: "Hindi" }], nice_to_haves: [], weights: { skills: 60, experience: 40 }, custom_traits: [] };

const CASES: Case[] = [
  // ---- jobs ----
  { route: "jobs", method: "POST", body: () => ({ title: "M9 should not exist" }), expect: { anon: 401, hm: 403 } },
  { route: "jobs/[id]", method: "PUT", params: () => ({ id: fx.jobId }), body: () => ({ title: "M9 hacked" }), expect: WRITE },
  { route: "jobs/[id]/rubric", method: "PUT", params: () => ({ id: fx.jobId }), body: () => goodRubric, expect: WRITE },
  { route: "jobs/[id]/rubric/draft", method: "POST", params: () => ({ id: fx.jobId }), body: () => ({}), expect: WRITE },
  {
    route: "jobs/[id]/candidates/import",
    method: "POST",
    params: () => ({ id: fx.jobId }),
    body: () => ({ rows: [{ name: "Intruder", phone: "+15550190000" }], consent_confirmed: true }),
    expect: WRITE,
  },
  // closing works for admin/recruiter (tests/calls/execution-fixes.test.ts); refused here
  { route: "jobs/[id]/close", method: "POST", params: () => ({ id: fx.jobId }), body: () => ({}), expect: WRITE },
  // role profile (admin/recruiter writes covered in tests/eval/role-profile-routes.test.ts)
  { route: "jobs/[id]/role-profile", method: "PUT", params: () => ({ id: fx.jobId }), body: () => ({}), expect: WRITE },
  { route: "jobs/[id]/role-profile/generate", method: "POST", params: () => ({ id: fx.jobId }), body: () => ({}), expect: WRITE },
  { route: "jobs/[id]/ranking", method: "GET", params: () => ({ id: fx.jobId }), expect: READ },
  // export is a read, but restricted to admin/recruiter (candidate PII in bulk)
  { route: "jobs/[id]/export", method: "GET", params: () => ({ id: fx.jobId }), expect: { anon: 401, hm: 403, other: 404, recruiter: 200 } },
  // ---- candidates ----
  { route: "candidates/[id]", method: "GET", params: () => ({ id: fx.candidateId }), expect: READ },
  {
    route: "candidates/[id]/actions",
    method: "POST",
    params: () => ({ id: fx.candidateId }),
    body: () => ({ type: "shortlist" }),
    expect: WRITE,
  },
  // ---- batches ----
  { route: "batches", method: "POST", body: () => ({ job_id: fx.jobId }), expect: WRITE },
  { route: "batches/[id]", method: "GET", params: () => ({ id: fx.batchId }), expect: READ },
  { route: "batches/[id]/cancel", method: "POST", params: () => ({ id: fx.batchId }), expect: WRITE },
  // ---- single calls ----
  { route: "calls/phone", method: "POST", body: () => ({ candidate_id: fx.candidateId }), expect: WRITE },
  { route: "calls/web-session", method: "POST", body: () => ({ candidate_id: fx.candidateId }), expect: WRITE },
  // ---- company-wide reads (scoped to the caller's own company) ----
  { route: "talent-pool", method: "GET", url: () => "http://localhost/api/talent-pool", expect: { anon: 401, hm: 200, other: 200, recruiter: 200 } },
  { route: "settings/status", method: "GET", expect: { anon: 401, hm: 200, other: 200, recruiter: 200 } },
  // ---- machine routes (secret, not session) ----
  { route: "webhooks/bolna", method: "POST", body: () => ({ id: "m9", status: "completed" }), expect: { anon: 401 }, machine: true },
  { route: "bolna/reschedule", method: "POST", body: () => ({ action: "list", call_id: "x" }), expect: { anon: 401 }, machine: true },
  { route: "dispatch", method: "POST", body: () => ({}), expect: { anon: 401 }, machine: true },
  // ---- data retention (admin only) ----
  {
    route: "candidates/[id]/erase",
    method: "POST",
    params: () => ({ id: eraseCandidateId }),
    body: () => ({ confirm: true }),
    expect: { anon: 401, hm: 403, recruiter: 403, other: 404, admin: 200 },
  },
  {
    route: "settings/retention",
    method: "PUT",
    body: () => ({ recording_days: 90, transcript_days: 365 }),
    // other company's admin succeeds but only ever changes its OWN company (scoped by membership)
    expect: { anon: 401, hm: 403, recruiter: 403, other: 200, admin: 200 },
  },
  // ---- call lines (company-wide, admin only) ----
  {
    route: "settings/lines",
    method: "PUT",
    body: () => ({ lines: 3 }),
    expect: { anon: 401, hm: 403, recruiter: 403, other: 200, admin: 200 },
  },
  // ---- fairness + messaging ----
  { route: "jobs/[id]/bias", method: "GET", params: () => ({ id: fx.jobId }), expect: READ },
  { route: "messaging/messages", method: "GET", url: () => "http://localhost/api/messaging/messages", expect: { anon: 401, hm: 403, recruiter: 403, admin: 200 } },
  { route: "messaging/sweep", method: "POST", body: () => ({}), expect: { anon: 401 }, machine: true },
  // ---- public (no session; token / rate-limited, tested in their module suites) ----
  { route: "apply/[jobId]", method: "POST", expect: {}, public: true },
  { route: "apply/otp/start", method: "POST", expect: {}, public: true },
  { route: "apply/otp/verify", method: "POST", expect: {}, public: true },
  { route: "pick-time", method: "POST", expect: {}, public: true },
];

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return routeFiles(p);
    return name === "route.ts" ? [relative(API_DIR, dir)] : [];
  });
}

async function load(route: string): Promise<Mod> {
  const key = `../../app/api/${route}/route.ts`;
  const loader = ROUTE_MODULES[key];
  if (!loader) throw new Error(`no route module ${key}`);
  return loader();
}

async function call(c: Case, who: Who): Promise<Response> {
  const mod = await load(c.route);
  const handler = mod[c.method];
  const client = { anon: cast.anon, hm: cast.hm, other: cast.other, recruiter: cast.recruiter, admin: cast.admin }[who];
  as(client);
  const url = c.url?.() ?? `http://localhost/api/${c.route}`;
  const req = jsonReq(c.method, c.method === "GET" ? undefined : (c.body?.() ?? {}), url);
  return handler(req, { params: Promise.resolve(c.params?.() ?? {}) });
}

beforeAll(async () => {
  process.env.BOLNA_WEBHOOK_SECRET ||= "m9-test-secret";
  process.env.DISPATCH_SECRET ||= "m9-test-secret";
  cast = await castOfUsers();
  fx = await makeFixture("M9 matrix job");
  jobs.push(fx.jobId);
  const svc = service();
  const e = await svc
    .from("candidates")
    .insert({ company_id: ACME, job_id: fx.jobId, name: "M9 Erase Me", phone: "+15550199999", source: "csv", status: "imported" })
    .select("id")
    .single();
  if (e.error) throw e.error;
  eraseCandidateId = e.data.id as string;
  for (const id of [ACME, OTHER]) {
    const { data } = await svc.from("companies").select("retention_recording_days, retention_transcript_days, concurrency_limit").eq("id", id).single();
    if (data) savedRetention[id] = data as (typeof savedRetention)[string];
  }
});

afterAll(async () => {
  for (const [id, v] of Object.entries(savedRetention)) await service().from("companies").update(v).eq("id", id);
  await dropJobs(jobs);
  await service().from("jobs").delete().eq("title", "M9 should not exist");
  await cleanupCast(cast);
});

describe("coverage", () => {
  it("every exported handler under app/api has a row in the role matrix", async () => {
    const missing: string[] = [];
    for (const route of routeFiles(API_DIR)) {
      const mod = await load(route);
      for (const method of ["GET", "POST", "PUT", "DELETE", "PATCH"] as const) {
        if (typeof mod[method] !== "function") continue;
        if (!CASES.some((c) => c.route === route && c.method === method)) missing.push(`${method} /api/${route}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("the public apply route exposes POST only (nothing to read)", async () => {
    const mod = await load("apply/[jobId]");
    expect(Object.keys(mod).filter((k) => /^[A-Z]+$/.test(k))).toEqual(["POST"]);
  });
});

describe.each(CASES.filter((c) => !c.public))("$method /api/$route", (c) => {
  for (const who of ["anon", "hm", "other", "recruiter", "admin"] as const) {
    const want = c.expect[who];
    if (want === undefined) continue;
    it(`${who} -> ${want}`, async () => {
      const res = await call(c, who);
      const wanted = Array.isArray(want) ? want : [want];
      expect(wanted, `${c.method} ${c.route} as ${who}: got ${res.status} ${await res.clone().text()}`).toContain(res.status);
    });
  }
});

describe("writes refused above leave no trace", () => {
  it("job title, rubric versions, candidate status, batch status and calls are unchanged", async () => {
    const svc = service();
    const { data: job } = await svc.from("jobs").select("title, status").eq("id", fx.jobId).single();
    expect(job).toEqual({ title: "M9 matrix job", status: "open" });
    const { data: rubrics } = await svc.from("rubrics").select("version").eq("job_id", fx.jobId);
    expect(rubrics?.map((r) => r.version)).toEqual([1]);
    const { data: cands } = await svc.from("candidates").select("name, status").eq("job_id", fx.jobId);
    expect(cands).toEqual([{ name: "M9 Test", status: "imported" }]); // the erase target is gone, nothing else touched
    const { count: calls } = await svc.from("calls").select("id", { count: "exact", head: true }).eq("job_id", fx.jobId);
    expect(calls).toBe(0);
    const { data: batch } = await svc.from("batches").select("status").eq("id", fx.batchId).single();
    expect(batch?.status).toBe("done");
    const { count: created } = await svc.from("jobs").select("id", { count: "exact", head: true }).eq("title", "M9 should not exist");
    expect(created).toBe(0);
  });

  it("other company sees none of Acme's people in its talent pool", async () => {
    as(cast.other);
    const mod = await load("talent-pool");
    const res = await mod.GET(jsonReq("GET", undefined, "http://localhost/api/talent-pool"), { params: Promise.resolve({}) });
    const { rows } = (await res.json()) as { rows: { candidate_id?: string; id?: string; job_id?: string }[] };
    expect(rows.some((r) => r.job_id === fx.jobId || r.candidate_id === fx.candidateId || r.id === fx.candidateId)).toBe(false);
  });

  it("hiring manager can still add a note (read + notes)", async () => {
    as(cast.hm);
    const mod = await load("candidates/[id]/actions");
    const res = await mod.POST(jsonReq("POST", { type: "note", note: "M9 note" }), { params: Promise.resolve({ id: fx.candidateId }) });
    expect(res.status).toBe(201);
  });
});
