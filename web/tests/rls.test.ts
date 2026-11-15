/**
 * Row-level security tests against the LIVE Supabase project (founder rule: per-role tests).
 * Run: npm run test:rls   (needs web/.env.local and a prior `npm run seed`)
 *
 * Creates throwaway fixture rows in BOTH companies with the service role, signs in as each
 * seeded user with the anon key (exactly what the browser has), asserts, then cleans up.
 */
import { randomInt } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SEED, adminClient, seed } from "../scripts/seed";

// Untyped on purpose: the tests loop over table names and send deliberately invalid writes.
type DB = SupabaseClient;
type Readable = string;

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const ACME = SEED.acme.id;
const OTHER = SEED.other.id;

const COMPANY_TABLES = ["members", "jobs", "rubrics", "batches", "candidates", "calls", "scores", "actions"] as const;
const ALL_READABLE: Readable[] = ["companies", ...COMPANY_TABLES, "webhook_events", "candidate_ranking"];

function anonClient(): DB {
  return createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function signedIn(email: string, password: string): Promise<DB> {
  const c = anonClient();
  const { error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`sign-in failed for ${email}: ${error.message}`);
  return c;
}

/** Rows a client can see in a table/view, or [] + error flag if the request is rejected. */
async function readAll(c: DB, table: Readable) {
  const { data, error } = await c.from(table).select("*");
  return { rows: (data ?? []) as Record<string, unknown>[], error };
}

const service = adminClient() as unknown as SupabaseClient;
const fx: Record<"acme" | "other", { candidate: string; call: string; batch: string; score: string; action: string }> = {
  acme: { candidate: "", call: "", batch: "", score: "", action: "" },
  other: { candidate: "", call: "", batch: "", score: "", action: "" },
};
let webhookId = 0;
let anon: DB, acmeAdmin: DB, acmeHm: DB, otherAdmin: DB;
let acmeHmUserId = "";
let acmeAdminUserId = "";

async function makeFixtures(key: "acme" | "other", companyId: string, jobId: string) {
  const ins = async (table: string, row: Record<string, unknown>) => {
    const { data, error } = await service.from(table).insert(row).select("id").single();
    if (error) throw new Error(`fixture ${table}: ${error.message}`);
    return String((data as { id: string | number }).id);
  };
  fx[key].batch = await ins("batches", { job_id: jobId, company_id: companyId, total: 1 });
  fx[key].candidate = await ins("candidates", {
    company_id: companyId,
    job_id: jobId,
    name: `RLS Test ${key}`,
    phone: `+9199${randomInt(10_000_000, 99_999_999)}`,
    source: "rls_test",
  });
  fx[key].call = await ins("calls", {
    candidate_id: fx[key].candidate,
    job_id: jobId,
    company_id: companyId,
    batch_id: fx[key].batch,
  });
  fx[key].score = await ins("scores", {
    call_id: fx[key].call,
    candidate_id: fx[key].candidate,
    company_id: companyId,
    rubric_version: 1,
    qualities: { skills: { score: 4, quotes: [], reason: "test" } },
    must_have_results: [],
    flags: { other_role: null, culture_standout: false, wants_internship: false },
    summary: "rls fixture",
  });
  fx[key].action = await ins("actions", { candidate_id: fx[key].candidate, company_id: companyId, type: "note", note: "fixture" });
}

beforeAll(async () => {
  const ids = await seed(); // idempotent; guarantees users/companies/jobs exist
  acmeHmUserId = ids.acmeHm;
  acmeAdminUserId = ids.acmeAdmin;
  await makeFixtures("acme", ACME, SEED.acmeJobId);
  await makeFixtures("other", OTHER, SEED.otherJobId);
  const wh = await service.from("webhook_events").insert({ status: "rls_test", payload: {} }).select("id").single();
  if (wh.error) throw wh.error;
  webhookId = wh.data.id;

  anon = anonClient();
  acmeAdmin = await signedIn(SEED.users.acmeAdmin.email, process.env.SEED_ACME_ADMIN_PASSWORD!);
  acmeHm = await signedIn(SEED.users.acmeHm.email, process.env.SEED_ACME_HM_PASSWORD!);
  otherAdmin = await signedIn(SEED.users.otherAdmin.email, process.env.SEED_OTHER_ADMIN_PASSWORD!);
});

afterAll(async () => {
  await service.from("candidates").delete().eq("source", "rls_test"); // cascades calls, scores, actions
  await service.from("batches").delete().in("id", [fx.acme.batch, fx.other.batch].filter(Boolean));
  await service.from("webhook_events").delete().eq("status", "rls_test");
  // restore anything a failing test might have changed
  await service.from("jobs").update({ title: "Sales Executive" }).eq("id", SEED.acmeJobId);
  await service.from("jobs").update({ title: "Support Associate" }).eq("id", SEED.otherJobId);
  await service.from("jobs").delete().eq("title", "x");
});

// ---------------------------------------------------------------------------
describe("unauthenticated (anon key, no session)", () => {
  for (const table of ALL_READABLE) {
    it(`reads 0 rows or is rejected: ${table}`, async () => {
      const { rows } = await readAll(anon, table);
      expect(rows).toHaveLength(0);
    });
  }

  for (const table of ["companies", "jobs", "candidates", "members", "actions", "webhook_events"] as const) {
    it(`cannot insert into ${table}`, async () => {
      const rows: Record<string, Record<string, unknown>> = {
        companies: { name: "Anon Co" },
        jobs: { company_id: ACME, title: "x", jd_text: "x" },
        candidates: { company_id: ACME, job_id: SEED.acmeJobId, name: "x", phone: "+919000000001", source: "x" },
        members: { user_id: acmeHmUserId, company_id: OTHER, role: "admin" },
        actions: { company_id: ACME, candidate_id: fx.acme.candidate, type: "note" },
        webhook_events: { status: "anon", payload: { evil: true } },
      };
      const { error } = await anon.from(table).insert(rows[table] as never);
      expect(error).not.toBeNull();
    });
  }

  it("cannot update or delete Acme rows", async () => {
    const up = await anon.from("jobs").update({ title: "pwned" }).eq("id", SEED.acmeJobId).select();
    expect(up.data ?? []).toHaveLength(0);
    const del = await anon.from("candidates").delete().eq("id", fx.acme.candidate).select();
    expect(del.data ?? []).toHaveLength(0);
    const still = await service.from("jobs").select("title").eq("id", SEED.acmeJobId).single();
    expect(still.data?.title).toBe("Sales Executive");
  });
});

// ---------------------------------------------------------------------------
describe("company isolation", () => {
  const cases = [
    { who: "Acme admin", own: ACME, foreign: OTHER, client: () => acmeAdmin },
    { who: "Acme hiring manager", own: ACME, foreign: OTHER, client: () => acmeHm },
    { who: "Other Co admin", own: OTHER, foreign: ACME, client: () => otherAdmin },
  ];

  for (const { who, own, foreign, client } of cases) {
    describe(who, () => {
      it("sees own company and no other company (companies)", async () => {
        const { rows } = await readAll(client(), "companies");
        expect(rows.map((r) => r.id)).toEqual([own]);
      });

      for (const table of [...COMPANY_TABLES, "candidate_ranking"] as const) {
        it(`sees own rows and zero foreign rows: ${table}`, async () => {
          const { rows, error } = await readAll(client(), table);
          expect(error).toBeNull();
          expect(rows.length).toBeGreaterThan(0); // positive control: policy is not just "deny all"
          expect(rows.every((r) => r.company_id === own)).toBe(true);
          const direct = await client().from(table).select("*").eq("company_id", foreign);
          expect(direct.data ?? []).toHaveLength(0);
        });
      }

      it("cannot read webhook_events", async () => {
        const { rows } = await readAll(client(), "webhook_events");
        expect(rows).toHaveLength(0);
      });
    });
  }

  it("Acme admin cannot fetch an Other Co candidate by id", async () => {
    const { data } = await acmeAdmin.from("candidates").select("*").eq("id", fx.other.candidate);
    expect(data ?? []).toHaveLength(0);
  });

  it("Acme admin cannot insert a candidate into Other Co", async () => {
    const { error } = await acmeAdmin.from("candidates").insert({
      company_id: OTHER, job_id: SEED.otherJobId, name: "x", phone: "+919000000002", source: "rls_test",
    });
    expect(error).not.toBeNull();
  });

  it("Acme admin cannot attach an Acme-labelled candidate to an Other Co job", async () => {
    const { error } = await acmeAdmin.from("candidates").insert({
      company_id: ACME, job_id: SEED.otherJobId, name: "x", phone: "+919000000003", source: "rls_test",
    });
    expect(error).not.toBeNull();
  });

  it("Acme admin cannot update or delete Other Co rows", async () => {
    const up = await acmeAdmin.from("jobs").update({ title: "pwned" }).eq("id", SEED.otherJobId).select();
    expect(up.data ?? []).toHaveLength(0);
    const del = await acmeAdmin.from("candidates").delete().eq("id", fx.other.candidate).select();
    expect(del.data ?? []).toHaveLength(0);
    const still = await service.from("candidates").select("id").eq("id", fx.other.candidate);
    expect(still.data).toHaveLength(1);
  });

  it("Acme admin cannot add themselves to Other Co", async () => {
    const { error } = await acmeAdmin.from("members").insert({ user_id: acmeAdminUserId, company_id: OTHER, role: "admin" });
    expect(error).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe("hiring manager (read + notes only)", () => {
  it("cannot update the job", async () => {
    const { data } = await acmeHm.from("jobs").update({ title: "HM edit" }).eq("id", SEED.acmeJobId).select();
    expect(data ?? []).toHaveLength(0);
    const still = await service.from("jobs").select("title").eq("id", SEED.acmeJobId).single();
    expect(still.data?.title).toBe("Sales Executive");
  });

  it("cannot update the rubric", async () => {
    const { data } = await acmeHm.from("rubrics").update({ weights: { skills: 100 } }).eq("job_id", SEED.acmeJobId).select();
    expect(data ?? []).toHaveLength(0);
    const still = await service.from("rubrics").select("weights").eq("job_id", SEED.acmeJobId).eq("version", 1).single();
    expect(still.data?.weights).toEqual({ skills: 30, experience: 30, culture_fit: 25, confidence: 15 });
  });

  it("cannot create a new rubric version", async () => {
    const { error } = await acmeHm.from("rubrics").insert({
      job_id: SEED.acmeJobId, company_id: ACME, version: 999, weights: { skills: 100 }, is_current: false,
    });
    expect(error).not.toBeNull();
  });

  it("cannot create a job or edit the company", async () => {
    const job = await acmeHm.from("jobs").insert({ company_id: ACME, title: "x", jd_text: "x" });
    expect(job.error).not.toBeNull();
    const co = await acmeHm.from("companies").update({ name: "HM Co" }).eq("id", ACME).select();
    expect(co.data ?? []).toHaveLength(0);
  });

  it("cannot change candidates or promote itself", async () => {
    const cand = await acmeHm.from("candidates").update({ status: "shortlisted" }).eq("id", fx.acme.candidate).select();
    expect(cand.data ?? []).toHaveLength(0);
    const role = await acmeHm.from("members").update({ role: "admin" }).eq("user_id", acmeHmUserId).select();
    expect(role.data ?? []).toHaveLength(0);
  });

  it("can add a note", async () => {
    const { error } = await acmeHm.from("actions").insert({
      candidate_id: fx.acme.candidate, company_id: ACME, type: "note", note: "Strong storyteller", user_id: acmeHmUserId,
    });
    expect(error).toBeNull();
  });

  it("cannot shortlist (non-note action)", async () => {
    const { error } = await acmeHm.from("actions").insert({ candidate_id: fx.acme.candidate, company_id: ACME, type: "shortlist" });
    expect(error).not.toBeNull();
  });

  it("cannot write a note as someone else", async () => {
    const { error } = await acmeHm.from("actions").insert({
      candidate_id: fx.acme.candidate, company_id: ACME, type: "note", user_id: acmeAdminUserId,
    });
    expect(error).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe("admin (positive controls)", () => {
  it("can update own job", async () => {
    const { data, error } = await acmeAdmin.from("jobs").update({ title: "Sales Executive (edited)" }).eq("id", SEED.acmeJobId).select();
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    await acmeAdmin.from("jobs").update({ title: "Sales Executive" }).eq("id", SEED.acmeJobId);
  });

  it("can shortlist", async () => {
    const { error } = await acmeAdmin.from("actions").insert({
      candidate_id: fx.acme.candidate, company_id: ACME, type: "shortlist", user_id: acmeAdminUserId,
    });
    expect(error).toBeNull();
  });

  it("cannot edit the audit log", async () => {
    const { data } = await acmeAdmin.from("actions").update({ note: "rewritten" }).eq("id", fx.acme.action).select();
    expect(data ?? []).toHaveLength(0);
  });

  it("cannot read or write webhook_events", async () => {
    const r = await acmeAdmin.from("webhook_events").select("*").eq("id", webhookId);
    expect(r.data ?? []).toHaveLength(0);
    const w = await acmeAdmin.from("webhook_events").insert({ status: "x" });
    expect(w.error).not.toBeNull();
  });
});
