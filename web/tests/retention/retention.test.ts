/**
 * Data retention (PRD §11), live Supabase project with real RLS.
 *   - purge_expired_data(): backdated fixture rows in a throwaway company are cleared/deleted by the
 *     company's limits, fresh rows are kept, a count-only audit row is written, files are deleted.
 *   - POST /api/candidates/:id/erase per role: anon 401, recruiter 403, hiring manager 403,
 *     other company 404, admin 200 (everything gone, audit row without PII).
 *   - PUT /api/settings/retention: bounds + roles, and the database refuses non-admin changes.
 * Every row and file written here is created by the test and removed afterwards.
 */
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ACME, OTHER, castOfUsers, cleanupCast, dropJobs, jsonReq, makeFixture, service, type Cast, type DB } from "../security/helpers";

const h = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("server-only", () => ({}));
vi.mock("../../lib/supabase/server", () => ({
  createClient: async () => h.client,
  getUserClaims: async () => null,
}));
vi.mock("../../lib/supabase/admin", async () => {
  const { adminClient } = await import("../../scripts/seed");
  return { createAdminClient: () => adminClient() };
});

const as = (c: DB | null) => {
  h.client = c;
};
const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();
const rnd = () => randomBytes(4).toString("hex");

let cast: Cast;
const jobs: string[] = [];
const tempCompanies: string[] = [];
const files: string[] = [];

beforeAll(async () => {
  cast = await castOfUsers();
});

afterAll(async () => {
  const svc = service();
  if (files.length) await svc.storage.from("resumes").remove(files);
  await dropJobs(jobs);
  if (tempCompanies.length) await svc.from("companies").delete().in("id", tempCompanies); // cascades (incl. retention_runs)
  await svc.from("companies").update({ retention_recording_days: 90, retention_transcript_days: 365 } as never).in("id", [ACME, OTHER]);
  await cleanupCast(cast);
});

async function uploadFile(path: string) {
  const { error } = await service()
    .storage.from("resumes")
    .upload(path, new Blob(["retention test"], { type: "text/plain" }), { upsert: true, contentType: "text/plain" });
  if (error) throw error;
  files.push(path);
}

async function fileExists(path: string) {
  const folder = path.slice(0, path.lastIndexOf("/"));
  const { data } = await service().storage.from("resumes").list(folder);
  return (data ?? []).some((f) => `${folder}/${f.name}` === path);
}

const score = (callId: string, candidateId: string, companyId: string, createdAt: string) => ({
  call_id: callId,
  candidate_id: candidateId,
  company_id: companyId,
  rubric_version: 1,
  qualities: { skills: { score: 4, quotes: [{ text: "I sold things", ts: 3 }], reason: "ok" } },
  must_have_results: [],
  flags: {},
  summary: "retention test",
  created_at: createdAt,
});

// ---------------------------------------------------------------- purge
describe("purge_expired_data()", () => {
  const svc = service();
  let co: string;
  const ids: Record<string, string> = {};
  const oldResume = () => `${co}/${ids.job}/${ids.oldCand}/resume.txt`;

  beforeAll(async () => {
    const c = await svc
      .from("companies")
      .insert({ name: `Retention temp ${rnd()}`, retention_recording_days: 30, retention_transcript_days: 60 } as never)
      .select("id")
      .single();
    if (c.error) throw c.error;
    co = (c.data as { id: string }).id;
    tempCompanies.push(co);

    const job = await svc.from("jobs").insert({ company_id: co, title: "Retention purge job" }).select("id").single();
    if (job.error) throw job.error;
    ids.job = job.data.id;

    const mk = async (name: string, created: string) => {
      const r = await svc
        .from("candidates")
        .insert({ company_id: co, job_id: ids.job, name, phone: `+1555${Math.floor(1e6 + Math.random() * 8e6)}`, source: "csv", created_at: created })
        .select("id")
        .single();
      if (r.error) throw r.error;
      return r.data.id;
    };
    ids.oldCand = await mk("Old", ago(400));
    ids.newCand = await mk("New", ago(1));
    await uploadFile(oldResume());
    await svc.from("candidates").update({ resume_path: oldResume() }).eq("id", ids.oldCand);
    await svc.from("candidates").update({ resume_path: `${co}/${ids.job}/${ids.newCand}/resume.txt` }).eq("id", ids.newCand);

    const call = async (cand: string, started: string, exec: string) => {
      const r = await svc
        .from("calls")
        .insert({
          company_id: co,
          job_id: ids.job,
          candidate_id: cand,
          state: "finished",
          outcome: "completed",
          started_at: started,
          created_at: started,
          recording_url: "https://recordings.example/retention.mp3",
          transcript: "Agent: hi. Candidate: hello.",
          bolna_execution_id: exec,
        })
        .select("id")
        .single();
      if (r.error) throw r.error;
      return r.data.id;
    };
    // 45 days: past the 30-day recording limit, inside the 60-day transcript limit
    ids.midCall = await call(ids.oldCand, ago(45), `ret-mid-${rnd()}`);
    // 100 days: past both
    ids.oldCall = await call(ids.oldCand, ago(100), `ret-old-${rnd()}`);
    // 2 days: inside both
    ids.newCall = await call(ids.newCand, ago(2), `ret-new-${rnd()}`);
    // last activity for the old candidate becomes 100 days (resume window is 60), recording age stays 45
    await svc.from("calls").update({ created_at: ago(100) }).eq("id", ids.midCall);

    for (const [callId, cand, at] of [
      [ids.oldCall, ids.oldCand, ago(100)],
      [ids.midCall, ids.oldCand, ago(45)],
      [ids.newCall, ids.newCand, ago(2)],
    ] as const) {
      const s = await svc.from("scores").insert(score(callId, cand, co, at) as never);
      if (s.error) throw s.error;
    }

    const { data: execs } = await svc.from("calls").select("id, bolna_execution_id").eq("company_id", co);
    const exec = new Map((execs ?? []).map((r) => [r.id, r.bolna_execution_id as string]));
    const ev = await svc.from("webhook_events").insert([
      { bolna_execution_id: exec.get(ids.oldCall), status: "completed", payload: { transcript: "x" }, received_at: ago(100) },
      { bolna_execution_id: exec.get(ids.newCall), status: "completed", payload: { transcript: "y" }, received_at: ago(2) },
    ]);
    if (ev.error) throw ev.error;
  });

  it("is not callable by signed-in users (service role / cron only)", async () => {
    const { error } = await cast.admin.rpc("purge_expired_data");
    expect(error).not.toBeNull();
    const anon = await cast.anon.rpc("purge_expired_data");
    expect(anon.error).not.toBeNull();
  });

  it("clears and deletes by the company's limits and keeps fresh data", async () => {
    const { data: summary, error } = await svc.rpc("purge_expired_data" as never);
    expect(error).toBeNull();
    expect(summary).toMatchObject({ companies: expect.any(Number) });

    const { data: calls } = await svc.from("calls").select("id, recording_url, transcript").eq("company_id", co);
    const byId = new Map((calls ?? []).map((c) => [c.id, c]));
    expect(byId.get(ids.oldCall)).toMatchObject({ recording_url: null, transcript: null });
    expect(byId.get(ids.midCall)).toMatchObject({ recording_url: null, transcript: "Agent: hi. Candidate: hello." });
    expect(byId.get(ids.newCall)).toMatchObject({ recording_url: "https://recordings.example/retention.mp3", transcript: "Agent: hi. Candidate: hello." });

    const { data: scores } = await svc.from("scores").select("call_id").eq("company_id", co);
    expect((scores ?? []).map((s) => s.call_id).sort()).toEqual([ids.midCall, ids.newCall].sort());

    const { data: cands } = await svc.from("candidates").select("id, resume_path").eq("company_id", co);
    const c = new Map((cands ?? []).map((r) => [r.id, r.resume_path]));
    expect(c.get(ids.oldCand)).toBeNull();
    expect(c.get(ids.newCand)).toBe(`${co}/${ids.job}/${ids.newCand}/resume.txt`);

    const { data: events } = await svc.from("webhook_events").select("payload").in("status", ["completed"]).like("bolna_execution_id", "ret-%");
    expect((events ?? []).map((e) => (e.payload as { transcript: string }).transcript)).not.toContain("x");
  });

  it("writes a count-only audit row for the company", async () => {
    const { data } = await svc.from("retention_runs" as never).select("*").eq("company_id", co).eq("kind", "purge");
    const rows = (data ?? []) as { counts: Record<string, unknown>; recording_days: number; transcript_days: number }[];
    expect(rows.length).toBeGreaterThanOrEqual(1);
    const r = rows[0];
    expect(r).toMatchObject({ recording_days: 30, transcript_days: 60 });
    expect(r.counts).toMatchObject({ recordings_cleared: 2, transcripts_cleared: 1, scores_deleted: 1, resume_files_queued: 1, webhook_events_deleted: 1 });
    for (const v of Object.values(r.counts)) expect(typeof v).toBe("number");
  });

  it("deletes the expired resume file from storage", async () => {
    // The purge only queues files; the app server deletes them (dispatcher cron run) with the key it
    // already holds, so the database never stores the service key (migration 20261116130000).
    const { flushRetentionFiles } = await import("../../lib/retention/files");
    await flushRetentionFiles(svc as never, 100);
    expect(await fileExists(oldResume())).toBe(false);
  }, 60_000);

  it("a second run changes nothing more (idempotent)", async () => {
    await svc.rpc("purge_expired_data" as never);
    const { data: scores } = await svc.from("scores").select("call_id").eq("company_id", co);
    expect(scores?.length).toBe(2);
    const { data: calls } = await svc.from("calls").select("transcript").eq("id", ids.newCall).single();
    expect(calls?.transcript).not.toBeNull();
  });
});

// ---------------------------------------------------------------- audit RLS
describe("retention_runs visibility", () => {
  beforeAll(async () => {
    await service()
      .from("retention_runs" as never)
      .insert({ company_id: ACME, kind: "purge", counts: { test: 1 } } as never);
  });
  afterAll(async () => {
    await service()
      .from("retention_runs" as never)
      .delete()
      .eq("company_id", ACME)
      .contains("counts", { test: 1 });
  });

  it("admin of the company reads it; hiring manager, recruiter, other company and anon do not", async () => {
    const read = async (c: DB) => ((await c.from("retention_runs").select("id").eq("company_id", ACME)).data ?? []).length;
    expect(await read(cast.admin)).toBeGreaterThan(0);
    expect(await read(cast.hm)).toBe(0);
    expect(await read(cast.recruiter)).toBe(0);
    expect(await read(cast.other)).toBe(0);
    expect(await read(cast.anon)).toBe(0);
  });

  it("nobody can write audit rows from the client", async () => {
    const { error } = await cast.admin.from("retention_runs").insert({ company_id: ACME, kind: "purge", counts: {} });
    expect(error).not.toBeNull();
  });
});

// ---------------------------------------------------------------- erase
describe("POST /api/candidates/:id/erase", () => {
  const svc = service();
  let fx: { jobId: string; candidateId: string };
  let resume: string;

  const post = async (who: DB | null, id: string, body: unknown = { confirm: true }) => {
    as(who);
    const { POST } = await import("../../app/api/candidates/[id]/erase/route");
    return POST(jsonReq("POST", body), { params: Promise.resolve({ id }) } as never);
  };

  beforeAll(async () => {
    fx = await makeFixture("Retention erase job");
    jobs.push(fx.jobId);
    resume = `${ACME}/${fx.jobId}/${fx.candidateId}/resume.txt`;
    await uploadFile(resume);
    await svc.from("candidates").update({ resume_path: resume }).eq("id", fx.candidateId);
    const call = await svc
      .from("calls")
      .insert({ company_id: ACME, job_id: fx.jobId, candidate_id: fx.candidateId, state: "finished", outcome: "completed", transcript: "secret words", bolna_execution_id: `ret-erase-${rnd()}` })
      .select("id, bolna_execution_id")
      .single();
    if (call.error) throw call.error;
    const s = await svc.from("scores").insert(score(call.data.id, fx.candidateId, ACME, new Date().toISOString()) as never);
    if (s.error) throw s.error;
    const a = await svc.from("actions").insert({ company_id: ACME, candidate_id: fx.candidateId, type: "note", note: "private note" });
    if (a.error) throw a.error;
    const w = await svc.from("webhook_events").insert({ bolna_execution_id: call.data.bolna_execution_id, status: "completed", payload: { t: "secret" } });
    if (w.error) throw w.error;
  });

  it("unauthenticated -> 401", async () => {
    expect((await post(cast.anon, fx.candidateId)).status).toBe(401);
  });
  it("recruiter -> 403", async () => {
    expect((await post(cast.recruiter, fx.candidateId)).status).toBe(403);
  });
  it("hiring manager -> 403", async () => {
    expect((await post(cast.hm, fx.candidateId)).status).toBe(403);
  });
  it("other company admin -> 404", async () => {
    expect((await post(cast.other, fx.candidateId)).status).toBe(404);
  });
  it("malformed id -> 404", async () => {
    expect((await post(cast.admin, "not-a-uuid")).status).toBe(404);
  });
  it("admin without confirmation -> 400", async () => {
    expect((await post(cast.admin, fx.candidateId, {})).status).toBe(400);
  });
  it("the database refuses a recruiter calling erase_candidate directly", async () => {
    const { error } = await cast.recruiter.rpc("erase_candidate", { p_candidate_id: fx.candidateId });
    expect(error?.code).toBe("42501");
    const other = await cast.other.rpc("erase_candidate", { p_candidate_id: fx.candidateId });
    expect(other.error?.code).toBe("P0002");
  });
  it("refused attempts left everything in place", async () => {
    const { count } = await svc.from("candidates").select("id", { count: "exact", head: true }).eq("id", fx.candidateId);
    expect(count).toBe(1);
    expect(await fileExists(resume)).toBe(true);
  });

  it("admin -> 200, and every trace of the candidate is gone", async () => {
    const res = await post(cast.admin, fx.candidateId);
    expect(res.status, await res.clone().text()).toBe(200);
    const body = (await res.json()) as { counts: Record<string, number> };
    expect(body.counts).toMatchObject({ candidates_deleted: 1, calls_deleted: 1, scores_deleted: 1, actions_deleted: 1, webhook_events_deleted: 1, files_deleted: 1 });

    for (const t of ["candidates", "calls", "scores", "actions"] as const) {
      const col = t === "candidates" ? "id" : "candidate_id";
      const { count } = await svc.from(t).select("id", { count: "exact", head: true }).eq(col, fx.candidateId);
      expect(count, t).toBe(0);
    }
    const { count: ev } = await svc.from("webhook_events").select("id", { count: "exact", head: true }).contains("payload", { t: "secret" });
    expect(ev).toBe(0);
    expect(await fileExists(resume)).toBe(false);
  });

  it("writes an erase audit row with counts only (no PII, no candidate id)", async () => {
    const { data } = await svc
      .from("retention_runs" as never)
      .select("*")
      .eq("company_id", ACME)
      .eq("kind", "erase")
      .order("ran_at", { ascending: false })
      .limit(1);
    const row = (data as { counts: Record<string, unknown>; actor_id: string }[])[0];
    expect(row.counts).toMatchObject({ candidates_deleted: 1 });
    const text = JSON.stringify(row);
    expect(text).not.toContain(fx.candidateId);
    expect(text).not.toContain("M9 Test");
    expect(text).not.toContain("+1555");
    await svc
      .from("retention_runs" as never)
      .delete()
      .eq("id", (row as unknown as { id: number }).id);
  });

  it("a second erase of the same id -> 404", async () => {
    expect((await post(cast.admin, fx.candidateId)).status).toBe(404);
  });
});

// ---------------------------------------------------------------- settings
describe("PUT /api/settings/retention", () => {
  const put = async (who: DB | null, body: unknown) => {
    as(who);
    const { PUT } = await import("../../app/api/settings/retention/route");
    return PUT(jsonReq("PUT", body));
  };
  const valid = { recording_days: 30, transcript_days: 180 };
  const current = async () => {
    const { data } = await service().from("companies").select("*").eq("id", ACME).single();
    const d = data as unknown as { retention_recording_days: number; retention_transcript_days: number };
    return { recording_days: d.retention_recording_days, transcript_days: d.retention_transcript_days };
  };

  it("unauthenticated -> 401", async () => {
    expect((await put(cast.anon, valid)).status).toBe(401);
  });
  it("recruiter -> 403", async () => {
    expect((await put(cast.recruiter, valid)).status).toBe(403);
  });
  it("hiring manager -> 403", async () => {
    expect((await put(cast.hm, valid)).status).toBe(403);
  });
  it("refused attempts did not change the setting", async () => {
    expect(await current()).toEqual({ recording_days: 90, transcript_days: 365 });
  });

  it.each([
    [{ recording_days: 6, transcript_days: 365 }],
    [{ recording_days: 366, transcript_days: 365 }],
    [{ recording_days: 90, transcript_days: 29 }],
    [{ recording_days: 90, transcript_days: 731 }],
    [{ recording_days: 7.5, transcript_days: 365 }],
    [{ recording_days: "90", transcript_days: 365 }],
    [{ recording_days: 90 }],
    [null],
  ])("admin with out-of-bounds %j -> 400", async (body) => {
    expect((await put(cast.admin, body)).status).toBe(400);
  });

  it("admin at the bounds -> 200", async () => {
    for (const b of [
      { recording_days: 7, transcript_days: 30 },
      { recording_days: 365, transcript_days: 730 },
    ]) {
      const res = await put(cast.admin, b);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual(b);
      expect(await current()).toEqual(b);
    }
  });

  it("admin of another company changes only their own company", async () => {
    const res = await put(cast.other, { recording_days: 45, transcript_days: 400 });
    expect(res.status).toBe(200);
    expect(await current()).toEqual({ recording_days: 365, transcript_days: 730 });
    const { data } = await service().from("companies").select("*").eq("id", OTHER).single();
    expect(data).toMatchObject({ retention_recording_days: 45, retention_transcript_days: 400 });
  });

  it("the database refuses a recruiter changing retention directly", async () => {
    const { error } = await cast.recruiter
      .from("companies")
      .update({ retention_recording_days: 8 } as never)
      .eq("id", ACME);
    expect(error?.code).toBe("42501");
    expect((await current()).recording_days).toBe(365);
  });

  it("the database refuses out-of-bounds values even from the service role", async () => {
    const { error } = await service()
      .from("companies")
      .update({ retention_recording_days: 1 } as never)
      .eq("id", ACME);
    expect(error).not.toBeNull();
  });
});
