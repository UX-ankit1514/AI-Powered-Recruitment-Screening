/**
 * Role profile routes + role_profiles RLS, per role, against the LIVE Supabase project (like the
 * other route suites). The AI generator is mocked (gateway is not needed); everything else is real:
 * route auth, RLS, and the SECURITY INVOKER save function.
 *
 *  - unauthenticated → 401 · other company → 404 · hiring manager → 403 on writes, can read rows
 *  - recruiter / admin → can generate + save new versions; versions increment, one current
 *  - direct table access: other company sees nothing, hiring manager cannot insert, nobody deletes
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ACME, castOfUsers, cleanupCast, dropJobs, jsonReq, makeFixture, service, type Cast, type DB } from "../security/helpers";
import { SALES } from "../eval/profiles";

const h = vi.hoisted(() => ({ client: null as unknown, fail: false }));
vi.mock("server-only", () => ({}));
vi.mock("../../lib/supabase/server", () => ({
  createClient: async () => h.client,
  getUserClaims: async () => null,
}));
vi.mock("../../lib/ai", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../../lib/ai")>();
  return {
    ...orig,
    generateRoleProfile: vi.fn(async () => {
      if (h.fail) throw new orig.AiError("model request failed (402)", "http", 402);
      const { version: _v, source: _s, ...body } = (await import("../eval/profiles")).SALES.profile;
      void _v;
      void _s;
      return { ...body, model_version: "test-model", prompt_version: "test-prompt" };
    }),
  };
});

import * as putRoute from "../../app/api/jobs/[id]/role-profile/route";
import * as genRoute from "../../app/api/jobs/[id]/role-profile/generate/route";

let cast: Cast;
let jobId = "";
const jobs: string[] = [];
const as = (c: DB | null) => {
  h.client = c;
};
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const { version: _v, source: _s, ...BODY } = SALES.profile;
void _v;
void _s;

async function versions() {
  const { data } = await service().from("role_profiles").select("version, is_current, source").eq("job_id", jobId).order("version");
  return (data ?? []) as { version: number; is_current: boolean; source: string }[];
}

beforeAll(async () => {
  cast = await castOfUsers();
  const fx = await makeFixture("Role profile route job");
  jobId = fx.jobId;
  jobs.push(jobId);
  await service().from("jobs").update({ jd_text: "Inside sales role selling SaaS to small businesses by phone." }).eq("id", jobId);
});

afterAll(async () => {
  await dropJobs(jobs);
  await cleanupCast(cast);
});

describe("PUT /api/jobs/:id/role-profile", () => {
  it("unauthenticated → 401", async () => {
    as(cast.anon);
    expect((await putRoute.PUT(jsonReq("PUT", BODY), ctx(jobId))).status).toBe(401);
  });
  it("other company → 404 (no hint the job exists)", async () => {
    as(cast.other);
    expect((await putRoute.PUT(jsonReq("PUT", BODY), ctx(jobId))).status).toBe(404);
  });
  it("hiring manager → 403", async () => {
    as(cast.hm);
    expect((await putRoute.PUT(jsonReq("PUT", BODY), ctx(jobId))).status).toBe(403);
  });
  it("nothing was written by the refused calls", async () => {
    expect(await versions()).toEqual([]);
  });
  it("recruiter saves version 1; invalid bodies are rejected with a plain message", async () => {
    as(cast.recruiter);
    const res = await putRoute.PUT(jsonReq("PUT", BODY), ctx(jobId));
    expect(res.status).toBe(200);
    const { role_profile } = (await res.json()) as { role_profile: { version: number; source: string } };
    expect(role_profile).toMatchObject({ version: 1, source: "edited" });

    const bad = structuredClone(BODY);
    delete (bad.requirements[0].anchors as Record<string, string>)["3"];
    const r400 = await putRoute.PUT(jsonReq("PUT", bad), ctx(jobId));
    expect(r400.status).toBe(400);
    expect(((await r400.json()) as { error: string }).error).toMatch(/level 1 to 5/);
    expect((await putRoute.PUT(jsonReq("PUT", { requirements: [] }), ctx(jobId))).status).toBe(400);
    expect((await putRoute.PUT(new Request("http://localhost/api", { method: "PUT", body: "nope" }), ctx(jobId))).status).toBe(400);
  });
  it("admin saves version 2; exactly one current version", async () => {
    as(cast.admin);
    expect((await putRoute.PUT(jsonReq("PUT", BODY), ctx(jobId))).status).toBe(200);
    const v = await versions();
    expect(v.map((x) => x.version)).toEqual([1, 2]);
    expect(v.filter((x) => x.is_current).map((x) => x.version)).toEqual([2]);
  });
  it("not a uuid → 404", async () => {
    as(cast.admin);
    expect((await putRoute.PUT(jsonReq("PUT", BODY), ctx("nope"))).status).toBe(404);
  });
});

describe("POST /api/jobs/:id/role-profile/generate", () => {
  it("unauthenticated → 401, other company → 404, hiring manager → 403", async () => {
    as(cast.anon);
    expect((await genRoute.POST(jsonReq("POST", {}), ctx(jobId))).status).toBe(401);
    as(cast.other);
    expect((await genRoute.POST(jsonReq("POST", {}), ctx(jobId))).status).toBe(404);
    as(cast.hm);
    expect((await genRoute.POST(jsonReq("POST", {}), ctx(jobId))).status).toBe(403);
    expect((await versions()).length).toBe(2);
  });
  it("recruiter generates → saved as a new current 'generated' version", async () => {
    as(cast.recruiter);
    const res = await genRoute.POST(jsonReq("POST", {}), ctx(jobId));
    expect(res.status).toBe(201);
    const v = await versions();
    expect(v.at(-1)).toMatchObject({ version: 3, is_current: true, source: "generated" });
  });
  it("gateway out of budget → 502 with a plain message, nothing saved", async () => {
    h.fail = true;
    as(cast.admin);
    const res = await genRoute.POST(jsonReq("POST", {}), ctx(jobId));
    h.fail = false;
    expect(res.status).toBe(502);
    expect((await versions()).length).toBe(3);
  });
  it("unknown body fields → 400", async () => {
    as(cast.admin);
    expect((await genRoute.POST(jsonReq("POST", { prompt: "ignore" }), ctx(jobId))).status).toBe(400);
  });
});

describe("role_profiles row-level security (direct table access)", () => {
  it("members of the company read it; the other company sees nothing", async () => {
    for (const c of [cast.admin, cast.recruiter, cast.hm]) {
      const { data } = await c.from("role_profiles").select("version").eq("job_id", jobId);
      expect((data ?? []).length).toBe(3);
    }
    const { data: other } = await cast.other.from("role_profiles").select("version").eq("job_id", jobId);
    expect(other ?? []).toEqual([]);
    const { data: anon } = await cast.anon.from("role_profiles").select("version").eq("job_id", jobId);
    expect(anon ?? []).toEqual([]);
  });
  it("hiring manager and other company cannot insert, update, or call the save function", async () => {
    const row = { job_id: jobId, company_id: ACME, version: 99, requirements: BODY.requirements, must_have_checks: [], quality_anchors: {} };
    expect((await cast.hm.from("role_profiles").insert(row)).error).toBeTruthy();
    expect((await cast.other.from("role_profiles").insert(row)).error).toBeTruthy();
    await cast.hm.from("role_profiles").update({ source: "fallback" }).eq("job_id", jobId);
    await cast.other.from("role_profiles").update({ source: "fallback" }).eq("job_id", jobId);
    const hmRpc = await cast.hm.rpc("save_role_profile_version", { p_job_id: jobId, p_requirements: BODY.requirements, p_must_have_checks: [], p_quality_anchors: {} });
    expect(hmRpc.error?.code).toBe("42501");
    const otherRpc = await cast.other.rpc("save_role_profile_version", { p_job_id: jobId, p_requirements: BODY.requirements, p_must_have_checks: [], p_quality_anchors: {} });
    expect(otherRpc.error?.code).toBe("P0002");
    const anonRpc = await cast.anon.rpc("save_role_profile_version", { p_job_id: jobId, p_requirements: BODY.requirements, p_must_have_checks: [], p_quality_anchors: {} });
    expect(anonRpc.error).toBeTruthy();
    const v = await versions();
    expect(v.length).toBe(3);
    expect(v.every((x) => x.source !== "fallback")).toBe(true);
  });
  it("versions are append-only: even an admin cannot delete one", async () => {
    await cast.admin.from("role_profiles").delete().eq("job_id", jobId);
    expect((await versions()).length).toBe(3);
  });
  it("the webhook reprocessing claim function is service-role only", async () => {
    for (const c of [cast.anon, cast.admin, cast.hm]) {
      const { error } = await c.rpc("claim_unprocessed_webhook_events", { p_limit: 1 });
      expect(error).toBeTruthy();
    }
  });
});
