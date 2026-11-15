/**
 * Shared helpers for the M9 security tests (live Supabase project, like the other route tests).
 * Users: the seeded Acme admin, Acme hiring manager and Other Co admin, plus a throwaway Acme
 * recruiter created per file and deleted afterwards. Only test rows are written, then removed.
 */
import { randomBytes } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SEED, adminClient, seed } from "../../scripts/seed";

export type DB = SupabaseClient;
export const ACME = SEED.acme.id;
export const OTHER = SEED.other.id;

export const service = () => adminClient() as unknown as DB;

export function anonClient(): DB {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function signIn(email: string, password: string): Promise<DB> {
  const c = anonClient();
  const { error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`sign-in failed for ${email}`);
  return c;
}

export type Cast = { anon: DB; admin: DB; hm: DB; other: DB; recruiter: DB; recruiterId: string };

/** Seeds, signs everyone in and creates a throwaway Acme recruiter. Call cleanupCast() after. */
export async function castOfUsers(): Promise<Cast> {
  await seed();
  const svc = service();
  const u = SEED.users;
  const [admin, hm, other] = await Promise.all([
    signIn(u.acmeAdmin.email, process.env[u.acmeAdmin.passwordEnv]!),
    signIn(u.acmeHm.email, process.env[u.acmeHm.passwordEnv]!),
    signIn(u.otherAdmin.email, process.env[u.otherAdmin.passwordEnv]!),
  ]);
  const email = `m9-recruiter-${randomBytes(4).toString("hex")}@acme.pingo.test`;
  const password = randomBytes(18).toString("base64url");
  const created = await svc.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) throw created.error ?? new Error("could not create recruiter");
  const recruiterId = created.data.user.id;
  const m = await svc.from("members").insert({ user_id: recruiterId, company_id: ACME, role: "recruiter" });
  if (m.error) throw m.error;
  return { anon: anonClient(), admin, hm, other, recruiter: await signIn(email, password), recruiterId };
}

export async function cleanupCast(c: Cast | undefined) {
  if (c?.recruiterId) await service().auth.admin.deleteUser(c.recruiterId);
}

/** A throwaway open Acme job with rubric v1, one candidate and one batch. */
export async function makeFixture(title: string) {
  const svc = service();
  const job = await svc.from("jobs").insert({ company_id: ACME, title, jd_text: "Sell things." }).select("id").single();
  if (job.error) throw job.error;
  const jobId = job.data.id as string;
  const r = await svc.from("rubrics").insert({ job_id: jobId, company_id: ACME, version: 1, weights: { skills: 50, experience: 50 }, is_current: true });
  if (r.error) throw r.error;
  const phone = `+1555019${String(Math.floor(Math.random() * 10_000)).padStart(4, "0")}`;
  const cand = await svc
    .from("candidates")
    .insert({ company_id: ACME, job_id: jobId, name: "M9 Test", phone, source: "csv", status: "imported" })
    .select("id")
    .single();
  if (cand.error) throw cand.error;
  const batch = await svc.from("batches").insert({ company_id: ACME, job_id: jobId, total: 0, status: "done" }).select("id").single();
  if (batch.error) throw batch.error;
  return { jobId, candidateId: cand.data.id as string, batchId: batch.data.id as string };
}

export async function dropJobs(ids: string[]) {
  if (ids.length) await service().from("jobs").delete().in("id", ids); // cascades
}

export const jsonReq = (method: string, body?: unknown, url = "http://localhost/api") =>
  new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
