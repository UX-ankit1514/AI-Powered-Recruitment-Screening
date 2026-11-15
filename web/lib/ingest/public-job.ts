import "server-only";
import { createAdminClient } from "../supabase/admin";
import { UUID } from "./http";

/** The only job facts the public apply page may show: id, title, company name (open jobs only). */
export async function getPublicJob(jobId: string): Promise<{ id: string; title: string; company: string } | null> {
  if (!UUID.test(jobId)) return null;
  const db = createAdminClient();
  const { data: job } = await db.from("jobs").select("id, title, status, company_id").eq("id", jobId).maybeSingle();
  if (!job || job.status !== "open") return null;
  const { data: co } = await db.from("companies").select("name").eq("id", job.company_id).maybeSingle();
  return { id: job.id, title: job.title, company: co?.name ?? "the hiring team" };
}
