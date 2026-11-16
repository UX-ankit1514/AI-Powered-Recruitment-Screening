import { z } from "zod";
import { closeJob } from "@/lib/calls/cancel";
import { WRITE_ROLES, json, jsonError, requireJobRole } from "@/lib/ingest/http";

const Body = z.object({ cancel_callbacks: z.boolean().optional() }).catch({});

/**
 * POST /api/jobs/:id/close (admin/recruiter) — close the job: no new applications or calls, waiting
 *      calls cancelled, running batches stopped. Booked callbacks are kept unless
 *      { cancel_callbacks: true }. RLS applies to every write.
 */
export async function POST(req: Request, ctx: RouteContext<"/api/jobs/[id]/close">) {
  const { id } = await ctx.params;
  const auth = await requireJobRole(id, WRITE_ROLES);
  if (auth instanceof Response) return auth;
  const { cancel_callbacks } = Body.parse(await req.json().catch(() => ({})));
  const res = await closeJob(auth.supabase, auth.job.id, { cancelCallbacks: cancel_callbacks === true });
  if (!res.ok) return jsonError(res.error === "42501" ? 403 : 400, "Could not close the job");
  return json({ status: "closed", cancelled: res.cancelled, callbacks_kept: res.callbacks_kept });
}
