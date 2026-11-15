import { handlePutRetention } from "@/lib/retention/settings";

/** PUT /api/settings/retention — admin only. Body: { recording_days: 7-365, transcript_days: 30-730 }. */
export async function PUT(req: Request) {
  return handlePutRetention(req);
}
