/** Fire-and-forget nudge to POST /api/dispatch (cron covers anything this misses). */
import { appBaseUrl } from "./config";

export async function kickDispatcher(jobId?: string | null, origin?: string): Promise<void> {
  const base = appBaseUrl(origin);
  const secret = process.env.DISPATCH_SECRET;
  if (!base || !secret) return;
  try {
    await fetch(`${base}/api/dispatch`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-dispatch-secret": secret },
      body: JSON.stringify(jobId ? { job_id: jobId } : {}),
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    // best effort: the request keeps running server-side; the every-minute cron is the backstop
  }
}
