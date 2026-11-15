/**
 * M9: the rubric save is one atomic database call (public.save_rubric_version), with the same
 * per-role rules whether it is reached through the route or called directly over PostgREST.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { castOfUsers, cleanupCast, dropJobs, jsonReq, makeFixture, service, type Cast, type DB } from "./helpers";

const h = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("server-only", () => ({}));
vi.mock("../../lib/supabase/server", () => ({ createClient: async () => h.client, getUserClaims: async () => null }));

import * as rubricRoute from "../../app/api/jobs/[id]/rubric/route";

let cast: Cast;
let jobId = "";
const jobs: string[] = [];
const rubric = (skills: number) => ({ must_haves: [{ text: "Hindi" }], nice_to_haves: [], weights: { skills, experience: 100 - skills }, custom_traits: [] });
const rpcArgs = (skills: number) => ({
  p_job_id: jobId,
  p_must_haves: [{ text: "Hindi" }],
  p_nice_to_haves: [],
  p_weights: { skills, experience: 100 - skills },
  p_custom_traits: [],
});

async function versions() {
  const { data } = await service().from("rubrics").select("version, is_current").eq("job_id", jobId).order("version");
  return (data ?? []) as { version: number; is_current: boolean }[];
}
const put = (c: DB, skills: number) => {
  h.client = c;
  return rubricRoute.PUT(jsonReq("PUT", rubric(skills)), { params: Promise.resolve({ id: jobId }) });
};

beforeAll(async () => {
  cast = await castOfUsers();
  jobId = (await makeFixture("M9 rubric job")).jobId;
  jobs.push(jobId);
});
afterAll(async () => {
  await dropJobs(jobs);
  await cleanupCast(cast);
});

describe("save_rubric_version over PostgREST (direct)", () => {
  it("anon cannot execute it", async () => {
    const { error } = await cast.anon.rpc("save_rubric_version", rpcArgs(50));
    expect(error).toBeTruthy();
    expect(await versions()).toEqual([{ version: 1, is_current: true }]);
  });

  it("hiring manager gets 42501 and nothing changes", async () => {
    const { error } = await cast.hm.rpc("save_rubric_version", rpcArgs(50));
    expect(error?.code).toBe("42501");
    expect(await versions()).toEqual([{ version: 1, is_current: true }]);
  });

  it("another company's admin cannot see the job (P0002) and nothing changes", async () => {
    const { error } = await cast.other.rpc("save_rubric_version", rpcArgs(50));
    expect(error?.code).toBe("P0002");
    expect(await versions()).toEqual([{ version: 1, is_current: true }]);
  });

  it("recruiter saves v2 and retires v1 in one call", async () => {
    const { data, error } = await cast.recruiter.rpc("save_rubric_version", rpcArgs(70));
    expect(error).toBeNull();
    expect((data as { version: number }[])[0]).toMatchObject({ version: 2, is_current: true });
    expect(await versions()).toEqual([
      { version: 1, is_current: false },
      { version: 2, is_current: true },
    ]);
  });
});

describe("PUT /api/jobs/:id/rubric (atomic)", () => {
  it("10 concurrent saves: every one succeeds, versions are contiguous, exactly one is current", async () => {
    const before = (await versions()).length;
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) => put(i % 2 ? cast.admin : cast.recruiter, 10 + i)));
    expect(results.map((r) => r.status)).toEqual(Array(10).fill(200));
    const rows = await versions();
    expect(rows.map((r) => r.version)).toEqual(Array.from({ length: before + 10 }, (_, i) => i + 1));
    expect(rows.filter((r) => r.is_current)).toHaveLength(1);
    expect(rows.find((r) => r.is_current)?.version).toBe(before + 10);
  });

  it("the response is the saved current version", async () => {
    const res = await put(cast.admin, 55);
    const body = (await res.json()) as { rubric: { version: number; is_current: boolean; weights: Record<string, number>; job_id: string } };
    expect(body.rubric).toMatchObject({ is_current: true, job_id: jobId, weights: { skills: 55, experience: 45 } });
  });
});
