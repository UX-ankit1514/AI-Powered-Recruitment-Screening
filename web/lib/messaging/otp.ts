/**
 * Apply-form phone verification (public, no session).
 *   POST /api/apply/otp/start  {job_id, phone}        → sends a 6-digit code (10-min expiry)
 *   POST /api/apply/otp/verify {job_id, phone, code}  → {phone_token} (30 min) for the apply route
 *
 * Codes are stored only as an HMAC (bound to phone + job), checked atomically in SQL with a hard
 * cap of 5 attempts. Rate limits: per IP and per phone (start), per IP (verify).
 * job_id is required so codes are only sent for a real, open job (no free SMS relay).
 *
 * Modes (provider.ts otpMode): on = real SMS; dev = log provider outside production, the code is
 * returned as dev_code for the screen; off = log provider in production, OTP skipped (rate limits
 * still apply) and Settings shows "Phone verification off: no SMS provider".
 */
import { randomInt } from "node:crypto";
import { z } from "zod";
import { normalizePhone } from "../ingest/phone";
import { createAdminClient } from "../supabase/admin";
import { otpHash, phoneHash, secretConfigured, signPhoneToken } from "./crypto";
import { otpMode } from "./provider";
import { ipKey, LIMITS, overLimit } from "./rate-limit";
import { deliver, untypedDb, type AnyDb } from "./store";

export const OTP_TTL_S = 600;
export const OTP_MAX_ATTEMPTS = 5;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const StartBody = z.object({ job_id: z.string().regex(UUID), phone: z.string().trim().min(1).max(40) });
const VerifyBody = StartBody.extend({ code: z.string().trim().max(12) });

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const err = (status: number, error: string) => json({ error }, status);

async function readJson(req: Request): Promise<unknown> {
  return req.json().catch(() => null);
}

async function openJob(db: AnyDb, jobId: string) {
  const { data: job } = await db.from("jobs").select("id, company_id, status").eq("id", jobId).maybeSingle();
  if (!job || job.status !== "open") return null;
  const { data: company } = await db.from("companies").select("name").eq("id", job.company_id).maybeSingle();
  return { id: job.id as string, companyId: job.company_id as string, company: (company?.name as string) ?? "Pingo" };
}

export async function handleOtpStart(req: Request, opts: { db?: AnyDb } = {}): Promise<Response> {
  if (!secretConfigured()) return err(503, "Phone verification is not available right now. Try again soon.");
  const db = opts.db ?? untypedDb(createAdminClient());
  if (await overLimit(db, LIMITS.otpStartIp, ipKey(req))) return err(429, "Too many codes requested from this network. Try again later.");

  const parsed = StartBody.safeParse(await readJson(req));
  if (!parsed.success) return err(400, "Enter your mobile number");
  const phone = normalizePhone(parsed.data.phone);
  if (!phone.ok) return err(400, "Enter a valid mobile number, e.g. +91 98765 43210");
  const job = await openJob(db, parsed.data.job_id);
  if (!job) return err(404, "This job is not accepting applications");

  const mode = otpMode();
  if (mode === "off") return json({ ok: true, verification: "off" });

  const ph = phoneHash(phone.phone);
  const rateKey = `${ph}:${job.id}`;
  if ((await overLimit(db, LIMITS.otpStartPhone, rateKey)) || (await overLimit(db, LIMITS.otpStartPhoneDay, rateKey))) {
    return err(429, "Too many codes for this number. Wait a few minutes and try again.");
  }

  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  // Only the newest code works.
  await db.from("phone_otps").update({ consumed_at: new Date().toISOString() }).eq("phone_hash", ph).eq("job_id", job.id).is("verified_at", null).is("consumed_at", null);
  const { error } = await db.from("phone_otps").insert({
    job_id: job.id,
    phone_hash: ph,
    code_hash: otpHash(ph, job.id, code),
    expires_at: new Date(Date.now() + OTP_TTL_S * 1000).toISOString(),
  });
  if (error) return err(500, "Could not create a code. Try again.");

  const sent = await deliver(db, {
    companyId: job.companyId,
    kind: "otp",
    to: phone.phone,
    body: `${code} is your code to apply to ${job.company} on Pingo. It expires in 10 minutes. Do not share it.`,
    storedBody: `•••••• is your code to apply to ${job.company} on Pingo. It expires in 10 minutes. Do not share it.`,
  });
  if (sent.status === "failed" || sent.status === "error") return err(502, "We could not send the code. Try again in a minute.");

  return json({ ok: true, verification: mode, expires_in: OTP_TTL_S, ...(mode === "dev" ? { dev_code: code } : {}) });
}

export async function handleOtpVerify(req: Request, opts: { db?: AnyDb } = {}): Promise<Response> {
  if (!secretConfigured()) return err(503, "Phone verification is not available right now. Try again soon.");
  const db = opts.db ?? untypedDb(createAdminClient());
  if (await overLimit(db, LIMITS.otpVerifyIp, ipKey(req))) return err(429, "Too many tries from this network. Try again later.");

  const parsed = VerifyBody.safeParse(await readJson(req));
  if (!parsed.success) return err(400, "Enter the 6-digit code");
  const phone = normalizePhone(parsed.data.phone);
  if (!phone.ok) return err(400, "Enter a valid mobile number, e.g. +91 98765 43210");
  if (otpMode() === "off") return json({ ok: true, verification: "off" });
  if (!/^\d{6}$/.test(parsed.data.code)) return err(400, "Enter the 6-digit code");

  const ph = phoneHash(phone.phone);
  const jobId = parsed.data.job_id.toLowerCase();
  const { data, error } = await db.rpc("verify_phone_otp", {
    p_phone_hash: ph,
    p_job_id: jobId,
    p_code_hash: otpHash(ph, jobId, parsed.data.code),
    p_max: OTP_MAX_ATTEMPTS,
  });
  if (error || typeof data !== "string") return err(500, "Could not check the code. Try again.");
  if (data === "ok") return json({ ok: true, verification: otpMode(), phone_token: signPhoneToken(ph, jobId) });
  if (data === "expired") return err(400, "That code has expired. Send a new one.");
  if (data === "none") return err(400, "Send a code to this number first.");
  if (data === "locked") return err(429, "Too many wrong tries. Send a new code.");
  const left = Number(data.split(":")[1] ?? 0);
  return err(400, `That code is not right. ${left} ${left === 1 ? "try" : "tries"} left.`);
}
