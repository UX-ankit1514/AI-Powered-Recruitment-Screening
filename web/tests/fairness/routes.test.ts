/**
 * Per-role tests for GET /api/jobs/:id/bias and the bias_inputs view, against the LIVE Supabase
 * project (same pattern as tests/results/results-routes.test.ts). Needs web/.env.local; seed() runs first.
 *
 * The route handler runs for real; only "who is signed in" is swapped, so RLS applies exactly as in
 * the browser. A throwaway Acme job with 16 scored candidates is created and removed.
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

import * as biasRoute from "../../app/api/jobs/[id]/bias/route";
import type { BiasSummary } from "../../lib/fairness/summary";

type DB = SupabaseClient;
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const ACME = SEED.acme.id;
const service = adminClient() as unknown as DB;

let anon: DB, acmeAdmin: DB, acmeHm: DB, otherAdmin: DB, recruiter: DB;
let recruiterId = "";
let jobId = "";

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
const get = () => new Request("http://localhost/api");
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const phone = () => `+9197${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;

async function addScored(name: string, score: number, language_mix: string, location: string, source: string) {
  const c = await service
    .from("candidates")
    .insert({ company_id: ACME, job_id: jobId, name, phone: phone(), source, status: "scored", profile: { location } })
    .select("id")
    .single();
  if (c.error) throw c.error;
  const id = (c.data as { id: string }).id;
  const call = await service
    .from("calls")
    .insert({ candidate_id: id, job_id: jobId, company_id: ACME, state: "finished", outcome: "completed", duration_s: 420, transcript: "user: hello" })
    .select("id")
    .single();
  if (call.error) throw call.error;
  const s = await service.from("scores").insert({
    call_id: (call.data as { id: string }).id,
    candidate_id: id,
    company_id: ACME,
    rubric_version: 1,
    qualities: { skills: { score, quotes: [], reason: "r" }, experience: { score, quotes: [], reason: "r" } },
    must_have_results: [],
    flags: { other_role: null, culture_standout: false, wants_internship: false, resume_mismatch: [], hr_review: null },
    summary: `${name} summary.`,
    language_mix,
  });
  if (s.error) throw s.error;
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

  const j = await service.from("jobs").insert({ company_id: ACME, title: "Bias watch test job", jd_text: "Sell things." }).select("id").single();
  if (j.error) throw j.error;
  jobId = (j.data as { id: string }).id;
  const r = await service.from("rubrics").insert({ job_id: jobId, company_id: ACME, version: 1, weights: { skills: 50, experience: 50 }, is_current: true });
  if (r.error) throw r.error;

  // 8 English speakers at 5/5 (overall 100), 8 Hinglish speakers at 3/5 (overall 50).
  for (let k = 0; k < 8; k++) await addScored(`BW English ${k}`, 5, "english", "Bengaluru", "csv");
  for (let k = 0; k < 8; k++) await addScored(`BW Hinglish ${k}`, 3, "hinglish", "Bengaluru", "csv");
});

afterAll(async () => {
  if (jobId) await service.from("jobs").delete().eq("id", jobId); // cascades candidates, calls, scores
  if (recruiterId) await service.auth.admin.deleteUser(recruiterId);
});

describe("GET /api/jobs/:id/bias", () => {
  it("rejects unauthenticated with 401", async () => {
    as(anon);
    const res = await biasRoute.GET(get(), ctx(jobId));
    expect(res.status).toBe(401);
  });

  it("blocks another company (404, nothing leaked)", async () => {
    as(otherAdmin);
    const res = await biasRoute.GET(get(), ctx(jobId));
    expect(res.status).toBe(404);
    expect(JSON.stringify(await res.json())).not.toContain("Bias watch test job");
  });

  it("404s on a malformed id", async () => {
    as(acmeAdmin);
    expect((await biasRoute.GET(get(), ctx("not-a-uuid"))).status).toBe(404);
  });

  for (const [role, client] of [
    ["hiring manager", () => acmeHm],
    ["recruiter", () => recruiter],
    ["admin", () => acmeAdmin],
  ] as const) {
    it(`lets the ${role} read the summary, with the Hinglish group flagged`, async () => {
      as(client());
      const res = await biasRoute.GET(get(), ctx(jobId));
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("no-store");
      const s = (await res.json()) as BiasSummary;
      expect(s.job.title).toBe("Bias watch test job");
      expect(s.overall).toMatchObject({ n: 16, mean: 75 });
      const lang = s.dimensions.find((d) => d.key === "language")!;
      expect(lang.groups.find((g) => g.label === "Hinglish")).toMatchObject({ n: 8, mean: 50, gap: -25, status: "flag" });
      expect(s.alerts.map((a) => a.group)).toEqual(["Hinglish"]);
      // the summary never carries names, phones or transcripts
      const body = JSON.stringify(s);
      expect(body).not.toContain("BW English");
      expect(body).not.toContain("+9197");
      expect(body).not.toContain("transcript");
    });
  }
});

describe("bias_inputs view (RLS via security_invoker)", () => {
  it("shows the job's rows to its own company", async () => {
    const { data, error } = await acmeHm.from("bias_inputs").select("candidate_id, language_mix").eq("job_id", jobId);
    expect(error).toBeNull();
    expect(data).toHaveLength(16);
  });
  it("shows nothing to another company", async () => {
    const { data, error } = await otherAdmin.from("bias_inputs").select("candidate_id").eq("job_id", jobId);
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });
  it("is closed to anonymous callers", async () => {
    const { data, error } = await anon.from("bias_inputs").select("candidate_id").eq("job_id", jobId);
    expect(error !== null || (data ?? []).length === 0).toBe(true);
  });
  it("cannot be written through by a client", async () => {
    const { error } = await acmeAdmin.from("bias_inputs").update({ language_mix: "other" }).eq("job_id", jobId);
    expect(error).not.toBeNull();
  });
  it("lets clients not write language_mix on scores directly (server-written only)", async () => {
    const { data } = await acmeAdmin.from("scores").update({ language_mix: "other" }).eq("company_id", ACME).select("id");
    const { error: e2 } = await acmeAdmin.from("scores").select("id").limit(1);
    expect(e2).toBeNull();
    expect(data ?? []).toHaveLength(0);
  });
});
