/**
 * Apply-route gate: when phone verification is on (otpMode on / dev), an application must carry a
 * `phone_token` from POST /api/apply/otp/verify for the SAME phone and job. Pure server check, no DB.
 *
 * Returns null to let the apply handler continue, or a 400 Response. It deliberately defers to
 * the apply handler (returns null) for inputs that handler already rejects or fakes (bad phone,
 * honeypot), so error messages and the honeypot behaviour stay exactly as they were.
 * Pass a CLONE of the request: the apply handler still needs to read the body.
 */
import { normalizePhone } from "../ingest/phone";
import { phoneHash, secretConfigured, verifyPhoneToken } from "./crypto";
import { otpMode } from "./provider";

const NEED = "Verify your mobile number first. Tap “Send code” and enter the 6-digit code.";

async function fields(req: Request): Promise<Record<string, unknown> | null> {
  const type = req.headers.get("content-type") ?? "";
  try {
    if (type.includes("multipart/form-data") || type.includes("application/x-www-form-urlencoded")) {
      const form = await req.formData();
      return Object.fromEntries([...form.entries()].filter(([, v]) => typeof v === "string"));
    }
    const j = await req.json();
    return j && typeof j === "object" && !Array.isArray(j) ? (j as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export async function requireVerifiedPhone(req: Request, jobId: string, now: Date = new Date()): Promise<Response | null> {
  if (otpMode() === "off") return null;
  if (!secretConfigured()) {
    return Response.json({ error: "Applications are paused for a moment. Try again soon." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  const f = await fields(req);
  if (!f) return null; // unreadable: the apply handler answers "Could not read the form"
  if (typeof f.website === "string" && f.website.trim()) return null; // honeypot: handler fakes success
  const phone = normalizePhone(f.phone);
  if (!phone.ok) return null; // handler gives the phone-format error

  const t = verifyPhoneToken(f.phone_token, now);
  if (t.ok && t.value.jobId === jobId.toLowerCase() && t.value.phoneHash === phoneHash(phone.phone)) return null;
  return Response.json(
    { error: t.ok || t.reason === "invalid" ? NEED : "Your verification expired. Send a new code to your number." },
    { status: 400, headers: { "Cache-Control": "no-store" } },
  );
}
