import { handleOtpStart } from "@/lib/messaging/otp";

/** POST /api/apply/otp/start {job_id, phone} — public; rate-limited. */
export async function POST(req: Request) {
  return handleOtpStart(req);
}
