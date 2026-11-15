import { handleSweep } from "@/lib/messaging/heads-up";

export const maxDuration = 60;

/** POST /api/messaging/sweep — heads-up messages for queued calls (pg_cron, x-dispatch-secret). */
export async function POST(req: Request) {
  return handleSweep(req);
}
