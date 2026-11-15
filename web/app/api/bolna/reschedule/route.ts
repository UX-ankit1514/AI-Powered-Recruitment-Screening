import { handleReschedule } from "@/lib/calls/reschedule";

export async function POST(req: Request) {
  return handleReschedule(req);
}
