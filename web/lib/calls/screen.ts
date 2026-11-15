/** POST /api/jobs/:id/screen (admin / recruiter) → queue calls for the job's imported candidates, then nudge the dispatcher. */
import { after } from "next/server";
import { handleCreateBatch } from "../ingest/batches";
import { json } from "../ingest/http";
import { kickDispatcher } from "./kick";

export async function handleScreen(req: Request, jobId: string, kick: (jobId: string) => void = (id) => after(() => kickDispatcher(id))): Promise<Response> {
  const raw = (await req.json().catch(() => null)) as { candidate_ids?: unknown } | null;
  const forwarded = new Request(req.url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ job_id: jobId, ...(raw && raw.candidate_ids !== undefined ? { candidate_ids: raw.candidate_ids } : {}) }),
  });
  const res = await handleCreateBatch(forwarded); // auth (401/403/404), validation and queueing live there
  if (res.status !== 201) return res;
  const data = (await res.json()) as { batch_id: string; queued: number };
  kick(jobId);
  return json({ queued: data.queued, batch_id: data.batch_id });
}
