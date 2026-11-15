/**
 * Database-backed rate limits for the public messaging routes (serverless instances share no
 * memory). Keys are HMAC-hashed before storage; raw IPs / phone numbers are never stored.
 */
import { clientIp } from "../calls/secret";
import { hmacHex } from "./crypto";
import type { AnyDb } from "./store";

export type Limit = { bucket: string; limit: number; windowS: number };

export const LIMITS = {
  otpStartIp: { bucket: "otp_start_ip", limit: 10, windowS: 3600 },
  otpStartPhone: { bucket: "otp_start_phone", limit: 3, windowS: 900 },
  otpStartPhoneDay: { bucket: "otp_start_phone_day", limit: 8, windowS: 86_400 },
  otpVerifyIp: { bucket: "otp_verify_ip", limit: 30, windowS: 3600 },
  pickViewIp: { bucket: "pick_view_ip", limit: 60, windowS: 600 },
  pickBookIp: { bucket: "pick_book_ip", limit: 10, windowS: 600 },
  pickBookToken: { bucket: "pick_book_token", limit: 6, windowS: 600 },
} satisfies Record<string, Limit>;

/** Records one hit; true when the key is now over the limit. Fails closed. */
export async function overLimit(db: AnyDb, l: Limit, rawKey: string): Promise<boolean> {
  const { data, error } = await db.rpc("messaging_rate_hit", {
    p_bucket: l.bucket,
    p_key_hash: hmacHex("id", `${l.bucket}:${rawKey}`),
    p_limit: l.limit,
    p_window_s: l.windowS,
  });
  if (error) return true;
  return data === true;
}

export const ipKey = (req: Request) => clientIp(req) ?? "unknown";
