import { handlePutLines } from "@/lib/calls/lines";

/** PUT /api/settings/lines — admin only. Body: { lines: 1-50 }. Call lines shared by every job of the company. */
export async function PUT(req: Request) {
  return handlePutLines(req);
}
