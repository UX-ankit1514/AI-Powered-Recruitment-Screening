import { handleOtpVerify } from "@/lib/messaging/otp";

/** POST /api/apply/otp/verify {job_id, phone, code} — public; 5 attempts per code; rate-limited. */
export async function POST(req: Request) {
  return handleOtpVerify(req);
}
