/**
 * Per-role route tests for M2 (import, ATS, batches, public apply) against the LIVE Supabase
 * project, like tests/rls.test.ts. Needs web/.env.local and seeded users (seed() runs here).
 *
 * The route handlers run for real; only the "who is signed in" part is swapped: the server
 * Supabase client is replaced with a client signed in as the seeded user (anon key + session,
 * so RLS applies exactly as in the browser). All writes go to a throwaway Acme job that is
 * deleted afterwards. Test phones use the fictional +1 555 0100-0199 range, so a queued call
 * that a dispatcher might pick up can never ring a real person.
 */
import { randomInt, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
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

import { handleApply, ipHash } from "../../lib/ingest/apply";
import { handleAtsApply } from "../../lib/ingest/ats-route";
import { handleBatchProgress, handleCreateBatch } from "../../lib/ingest/batches";
import { handleImport } from "../../lib/ingest/import";
import { __setResumeReader } from "../../lib/ingest/resume";
import { RESUME_BUCKET } from "../../lib/ingest/storage";
import * as applyRoute from "../../app/api/apply/[jobId]/route";

type DB = SupabaseClient;
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const ACME = SEED.acme.id;
const service = adminClient() as unknown as DB;

let anon: DB, acmeAdmin: DB, acmeHm: DB, otherAdmin: DB;
let jobId = ""; // throwaway Acme job
let closedJobId = "";
const ips: string[] = [];
const batchIds: string[] = [];

// Unique within a run (a random base + counter), so a job never gets two equal test phones.
let phoneSeq = randomInt(0, 9000);
const testPhone = () => `+1555010${String(phoneSeq++ % 10_000).padStart(4, "0")}`;
const as = (c: DB) => {
  h.client = c;
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

const jsonReq = (body: unknown, extra: Record<string, string> = {}) =>
  new Request("http://localhost/api", {
    method: "POST",
    headers: { "content-type": "application/json", ...extra },
    body: JSON.stringify(body),
  });

const formReq = (fd: FormData, ip?: string) =>
  new Request("http://localhost/api", { method: "POST", body: fd, headers: ip ? { "x-forwarded-for": `${ip}, 10.0.0.1` } : {} });

const newIp = () => {
  const ip = `203.0.113.${randomInt(1, 254)}-${randomUUID().slice(0, 8)}`;
  ips.push(ip);
  return ip;
};

async function candidatesOf(job: string) {
  const { data } = await service.from("candidates").select("*").eq("job_id", job);
  return (data ?? []) as Record<string, unknown>[];
}

beforeAll(async () => {
  await seed();
  anon = anonClient();
  acmeAdmin = await signedIn(SEED.users.acmeAdmin.email, SEED.users.acmeAdmin.passwordEnv);
  acmeHm = await signedIn(SEED.users.acmeHm.email, SEED.users.acmeHm.passwordEnv);
  otherAdmin = await signedIn(SEED.users.otherAdmin.email, SEED.users.otherAdmin.passwordEnv);

  const j = await service.from("jobs").insert({ company_id: ACME, title: "M2 test job", jd_text: "test" }).select("id").single();
  if (j.error) throw j.error;
  jobId = j.data.id;
  const c = await service
    .from("jobs")
    .insert({ company_id: ACME, title: "M2 closed job", jd_text: "test", status: "closed" })
    .select("id")
    .single();
  if (c.error) throw c.error;
  closedJobId = c.data.id;
  __setResumeReader(null); // M3 absent unless a test installs a fake
});

afterAll(async () => {
  __setResumeReader(undefined);
  if (jobId) {
    const { data: objs } = await service.storage.from(RESUME_BUCKET).list(`${ACME}/${jobId}`, { limit: 1000 });
    for (const folder of objs ?? []) {
      const { data: files } = await service.storage.from(RESUME_BUCKET).list(`${ACME}/${jobId}/${folder.name}`);
      const paths = (files ?? []).map((f) => `${ACME}/${jobId}/${folder.name}/${f.name}`);
      if (paths.length) await service.storage.from(RESUME_BUCKET).remove(paths);
    }
  }
  await service.from("jobs").delete().in("id", [jobId, closedJobId].filter(Boolean)); // cascades
  const hashes = ips.map(ipHash);
  if (hashes.length) await service.from("apply_rate_limits").delete().in("ip_hash", hashes);
});

// ---------------------------------------------------------------------------
describe("unauthenticated", () => {
  it("import -> 401", async () => {
    as(anon);
    const res = await handleImport(jsonReq({ rows: [{ name: "A", phone: testPhone() }], consent_confirmed: true }), jobId);
    expect(res.status).toBe(401);
    expect(await candidatesOf(jobId)).toHaveLength(0);
  });
  it("ATS apply -> 401", async () => {
    as(anon);
    expect((await handleAtsApply(jobId)).status).toBe(401);
  });
  it("create batch -> 401 (even with a bad body)", async () => {
    as(anon);
    expect((await handleCreateBatch(jsonReq({ job_id: jobId }))).status).toBe(401);
    expect((await handleCreateBatch(jsonReq("nope"))).status).toBe(401);
  });
  it("batch progress -> 401", async () => {
    as(anon);
    expect((await handleBatchProgress(randomUUID())).status).toBe(401);
  });
});

describe("hiring manager (read-only)", () => {
  it("import -> 403 and nothing written", async () => {
    as(acmeHm);
    const res = await handleImport(jsonReq({ rows: [{ name: "A", phone: testPhone() }], consent_confirmed: true }), jobId);
    expect(res.status).toBe(403);
    expect(await candidatesOf(jobId)).toHaveLength(0);
  });
  it("ATS apply -> 403", async () => {
    as(acmeHm);
    expect((await handleAtsApply(jobId)).status).toBe(403);
  });
  it("create batch -> 403", async () => {
    as(acmeHm);
    expect((await handleCreateBatch(jsonReq({ job_id: jobId }))).status).toBe(403);
  });
});

describe("other company", () => {
  it("cannot import into an Acme job (404, nothing written)", async () => {
    as(otherAdmin);
    const res = await handleImport(jsonReq({ rows: [{ name: "A", phone: testPhone() }], consent_confirmed: true }), jobId);
    expect(res.status).toBe(404);
    expect(await candidatesOf(jobId)).toHaveLength(0);
  });
  it("cannot run ATS or create a batch on an Acme job", async () => {
    as(otherAdmin);
    expect((await handleAtsApply(jobId)).status).toBe(404);
    expect((await handleCreateBatch(jsonReq({ job_id: jobId }))).status).toBe(404);
  });
  it("bad job ids are 404", async () => {
    as(acmeAdmin);
    expect((await handleImport(jsonReq({ rows: [{ name: "A", phone: "9876543210" }], consent_confirmed: true }), "nope")).status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
describe("import (Acme admin)", () => {
  const p1 = testPhone();
  const p2 = testPhone();

  it("requires consent_confirmed", async () => {
    as(acmeAdmin);
    const res = await handleImport(jsonReq({ rows: [{ name: "A", phone: p1 }] }), jobId);
    expect(res.status).toBe(400);
  });

  it("imports valid rows, reports invalid ones, dedupes in-file", async () => {
    as(acmeAdmin);
    const res = await handleImport(
      jsonReq({
        consent_confirmed: true,
        rows: [
          { name: "Asha Test", phone: p1, email: "Asha@Example.com", resume_note: "2y inside sales" },
          { name: "Asha Twin", phone: p1 },
          { name: "Ravi Test", phone: p2, source: "portal_mock" },
          { name: "No Phone", phone: "" },
          { name: "", phone: testPhone() },
          { name: "Bad", phone: "12345" },
        ],
      }),
      jobId,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.imported).toBe(2);
    expect(body.duplicates).toBe(1);
    expect(body.invalid.map((i: { row: number }) => i.row)).toEqual([4, 5, 6]);
    const rows = await candidatesOf(jobId);
    expect(rows).toHaveLength(2);
    const asha = rows.find((r) => r.phone === p1)!;
    expect(asha).toMatchObject({
      company_id: ACME,
      email: "asha@example.com",
      consent_source: "employer_upload",
      status: "imported",
      source: "csv",
    });
    expect(asha.consent_at).toBeTruthy();
    expect((asha.profile as { resume_note?: string }).resume_note).toBe("2y inside sales");
    expect(rows.find((r) => r.phone === p2)!.source).toBe("portal_mock");
  });

  it("re-import of the same phones counts duplicates, creates nothing", async () => {
    as(acmeAdmin);
    const res = await handleImport(jsonReq({ consent_confirmed: true, rows: [{ name: "Asha", phone: p1 }, { name: "Ravi", phone: p2 }] }), jobId);
    const body = await res.json();
    expect(body).toMatchObject({ imported: 0, duplicates: 2, invalid: [] });
    expect(await candidatesOf(jobId)).toHaveLength(2);
  });

  it("multipart CSV + resume files: quoted CSV, storage upload, company-scoped storage access", async () => {
    as(acmeAdmin);
    const p3 = testPhone();
    const p4 = testPhone();
    const csv = `name,phone,email,resume_filename\n"Kumar, Dev",${p3},dev@x.in,dev.txt\n\nMeera,${p4},,meera.pdf\n`;
    const fd = new FormData();
    fd.set("csv", new File([csv], "batch.csv", { type: "text/csv" }));
    fd.append("resumes", new File(["Dev Kumar. Three years of B2B SaaS sales at a CRM startup in Pune."], "dev.txt", { type: "text/plain" }));
    fd.append("resumes", new File(["%PDF-1.4 fake but magic bytes ok"], "meera.pdf", { type: "application/pdf" }));
    fd.set("consent_confirmed", "true");
    const res = await handleImport(formReq(fd), jobId);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ imported: 2, duplicates: 0, invalid: [], resumes_uploaded: 2, resume_issues: [] });

    const dev = (await candidatesOf(jobId)).find((r) => r.phone === p3)!;
    expect(dev.name).toBe("Kumar, Dev");
    expect(dev.resume_path).toBe(`${ACME}/${jobId}/${dev.id}/resume.txt`);
    expect((dev.profile as { resume_text?: string }).resume_text).toContain("B2B SaaS");

    const path = dev.resume_path as string;
    const hm = await acmeHm.storage.from(RESUME_BUCKET).download(path);
    expect(hm.error).toBeNull();
    const other = await otherAdmin.storage.from(RESUME_BUCKET).download(path);
    expect(other.data).toBeNull();
    const nobody = await anon.storage.from(RESUME_BUCKET).download(path);
    expect(nobody.data).toBeNull();
    // other company cannot write into Acme's folder; hiring manager cannot write either
    const ow = await otherAdmin.storage.from(RESUME_BUCKET).upload(`${ACME}/${jobId}/x/evil.txt`, new Blob(["x"]), { contentType: "text/plain" });
    expect(ow.error).not.toBeNull();
    const hw = await acmeHm.storage.from(RESUME_BUCKET).upload(`${ACME}/${jobId}/x/hm.txt`, new Blob(["x"]), { contentType: "text/plain" });
    expect(hw.error).not.toBeNull();
  });

  it("rejects a resume whose content does not match its extension", async () => {
    as(acmeAdmin);
    const fd = new FormData();
    fd.set("csv", new File([`name,phone,resume_filename\nFake,${testPhone()},fake.pdf`], "b.csv"));
    fd.append("resumes[]", new File(["not a pdf"], "fake.pdf", { type: "application/pdf" }));
    fd.set("consent_confirmed", "true");
    const body = await (await handleImport(formReq(fd), jobId)).json();
    expect(body.imported).toBe(1);
    expect(body.resumes_uploaded).toBe(0);
    expect(body.resume_issues[0].reason).toMatch(/not a real PDF/);
  });

  it("uses readResume when M3 provides it (profile + resume_only_score filled)", async () => {
    as(acmeAdmin);
    __setResumeReader(async (input: unknown, rubric: unknown, role: unknown) => {
      expect(rubric).toMatchObject({ must_haves: expect.any(Array) });
      expect(role).toBe("M2 test job");
      const text = String(input);
      return { profile: { current_role: "SDR", skills: ["cold calling"] }, resume_only_score: text.includes("strong") ? 88 : 40, resume_note: "auto note" };
    });
    try {
      const ph = testPhone();
      const body = await (
        await handleImport(
          jsonReq({ consent_confirmed: true, rows: [{ name: "Read Me", phone: ph, resume_text: "A strong resume with five years of SaaS sales experience." }] }),
          jobId,
        )
      ).json();
      expect(body.resumes_read).toBe(1);
      const row = (await candidatesOf(jobId)).find((r) => r.phone === ph)!;
      expect(Number(row.resume_only_score)).toBe(88);
      expect(row.profile).toMatchObject({ current_role: "SDR", resume_note: "auto note" });
    } finally {
      __setResumeReader(null);
    }
  });
});

// ---------------------------------------------------------------------------
describe("ATS filter + batches", () => {
  const ids: string[] = [];

  beforeAll(async () => {
    const rows = [95, 90, 85, 80, 75, 70, 65, 60, 55, 50].map((s, i) => ({
      company_id: ACME,
      job_id: jobId,
      name: `ATS ${i}`,
      phone: testPhone(),
      source: "csv",
      resume_only_score: s,
    }));
    // isolate: move earlier test candidates out of the pool
    await service.from("candidates").update({ status: "rejected" }).eq("job_id", jobId);
    const { data, error } = await service.from("candidates").insert(rows).select("id, resume_only_score");
    if (error) throw error;
    ids.push(...data.sort((a, b) => Number(b.resume_only_score) - Number(a.resume_only_score)).map((d) => d.id));
  });

  it("ats_filter marks those outside top pct (with rescue lane) as ats_filtered", async () => {
    await service.from("jobs").update({ ats_mode: "ats_filter", ats_top_pct: 30, ats_rescue: true }).eq("id", jobId);
    as(acmeAdmin);
    const res = await handleAtsApply(jobId);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ mode: "ats_filter", cutoff: 85, filtered: 5, rescued: 2 });
    const { data } = await service.from("candidates").select("id, status").in("id", ids);
    const st = new Map((data ?? []).map((r) => [r.id, r.status]));
    expect(ids.map((id) => st.get(id))).toEqual([
      "imported", "imported", "imported", "imported", "imported",
      "ats_filtered", "ats_filtered", "ats_filtered", "ats_filtered", "ats_filtered",
    ]);
  });

  it("batch queues only imported (never ats_filtered) candidates; progress is readable by members", async () => {
    as(acmeAdmin);
    const res = await handleCreateBatch(jsonReq({ job_id: jobId, candidate_ids: [ids[0], ids[1], ids[9]] }));
    expect(res.status).toBe(201);
    const body = await res.json();
    batchIds.push(body.batch_id);
    expect(body.queued).toBe(2);

    const { data: calls } = await service.from("calls").select("candidate_id, state, batch_id, company_id").eq("batch_id", body.batch_id);
    expect((calls ?? []).map((c) => c.candidate_id).sort()).toEqual([ids[0], ids[1]].sort());
    expect((calls ?? []).every((c) => c.state === "queued" && c.company_id === ACME)).toBe(true);
    const { data: cs } = await service.from("candidates").select("status").in("id", [ids[0], ids[1]]);
    expect((cs ?? []).every((c) => c.status === "queued")).toBe(true);

    as(acmeHm);
    const prog = await handleBatchProgress(body.batch_id);
    expect(prog.status).toBe(200);
    expect(await prog.json()).toMatchObject({ total: 2, queued: 2, in_flight: 0, done: 0, outcomes: {} });

    as(otherAdmin);
    expect((await handleBatchProgress(body.batch_id)).status).toBe(404);

    // don't leave dialable rows around
    await service.from("calls").delete().eq("batch_id", body.batch_id);
  });

  it("409 when nothing is eligible", async () => {
    as(acmeAdmin);
    expect((await handleCreateBatch(jsonReq({ job_id: jobId, candidate_ids: [ids[9]] }))).status).toBe(409);
  });

  it("call_everyone restores filtered candidates", async () => {
    await service.from("jobs").update({ ats_mode: "call_everyone" }).eq("id", jobId);
    as(acmeAdmin);
    expect(await (await handleAtsApply(jobId)).json()).toMatchObject({ filtered: 0 });
    const { data } = await service.from("candidates").select("status").in("id", ids.slice(5));
    expect((data ?? []).every((r) => r.status === "imported")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe("public apply", () => {
  const form = (o: Record<string, string>) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(o)) fd.set(k, v);
    return fd;
  };

  it("route exposes POST only (nothing to read)", () => {
    expect(Object.keys(applyRoute).filter((k) => /^[A-Z]+$/.test(k))).toEqual(["POST"]);
  });

  it("creates the candidate and returns exactly {ok:true}", async () => {
    as(anon);
    const ph = testPhone();
    const fd = form({ name: "Public Applicant", phone: ph, email: "pub@example.com", consent: "true" });
    fd.set("resume", new File(["My resume: four years of field sales in Bengaluru, fluent Hindi."], "cv.txt", { type: "text/plain" }));
    const res = await handleApply(formReq(fd, newIp()), jobId);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const row = (await candidatesOf(jobId)).find((r) => r.phone === ph)!;
    expect(row).toMatchObject({ source: "form", consent_source: "form", company_id: ACME, status: "imported" });
    expect(row.resume_path).toBe(`${ACME}/${jobId}/${row.id}/resume.txt`);

    // duplicate: same answer, no new row, no hint
    const again = await handleApply(formReq(form({ name: "Someone Else", phone: ph, consent: "true" }), newIp()), jobId);
    expect(await again.json()).toEqual({ ok: true });
    expect((await candidatesOf(jobId)).filter((r) => r.phone === ph)).toHaveLength(1);
  });

  it("requires consent, a name and a valid phone", async () => {
    expect((await handleApply(formReq(form({ name: "A", phone: testPhone() }), newIp()), jobId)).status).toBe(400);
    expect((await handleApply(formReq(form({ name: "", phone: testPhone(), consent: "true" }), newIp()), jobId)).status).toBe(400);
    expect((await handleApply(formReq(form({ name: "A", phone: "12345", consent: "true" }), newIp()), jobId)).status).toBe(400);
  });

  it("closed or unknown jobs are 404 and write nothing", async () => {
    const ph = testPhone();
    expect((await handleApply(formReq(form({ name: "A", phone: ph, consent: "true" }), newIp()), closedJobId)).status).toBe(404);
    expect((await handleApply(formReq(form({ name: "A", phone: ph, consent: "true" }), newIp()), randomUUID())).status).toBe(404);
    expect(await candidatesOf(closedJobId)).toHaveLength(0);
  });

  it("honeypot submissions are dropped silently", async () => {
    const ph = testPhone();
    const res = await handleApply(formReq(form({ name: "Bot", phone: ph, consent: "true", website: "http://spam" }), newIp()), jobId);
    expect(await res.json()).toEqual({ ok: true });
    expect((await candidatesOf(jobId)).filter((r) => r.phone === ph)).toHaveLength(0);
  });

  it("rate-limits to 5 per hour per IP", async () => {
    const ip = newIp();
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      const res = await handleApply(formReq(form({ name: `Rate ${i}`, phone: testPhone(), consent: "true" }), ip), jobId);
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 5).every((s) => s === 200)).toBe(true);
    expect(statuses[5]).toBe(429);
  });

  it("the rate-limit table is not readable or writable by clients", async () => {
    const r = await anon.from("apply_rate_limits").select("*");
    expect(r.data ?? []).toHaveLength(0);
    const w = await acmeAdmin.from("apply_rate_limits").insert({ ip_hash: "x" });
    expect(w.error).not.toBeNull();
    const a = await acmeAdmin.from("apply_rate_limits").select("*");
    expect(a.data ?? []).toHaveLength(0);
  });
});
