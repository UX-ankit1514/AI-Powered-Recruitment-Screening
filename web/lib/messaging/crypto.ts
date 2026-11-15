/**
 * Keys and signed tokens for messaging. Server only.
 *
 * One root secret, PICK_TIME_SECRET (env), with a separate derived key per purpose, so a token
 * minted for one purpose can never be replayed as another:
 *   pick   — the time-pick link in the heads-up message (compact binary token, short for SMS)
 *   phone  — "this phone was verified for this job" token returned by OTP verify
 *   otp    — HMAC of OTP codes (codes are never stored in clear text)
 *   id     — hashing phone numbers / IPs for lookups and rate limits
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export class MissingSecretError extends Error {
  constructor() {
    super("PICK_TIME_SECRET is not set");
  }
}

export function secretConfigured(): boolean {
  return (process.env.PICK_TIME_SECRET?.trim().length ?? 0) >= 32;
}

function rootSecret(): string {
  const s = process.env.PICK_TIME_SECRET?.trim();
  if (!s || s.length < 32) throw new MissingSecretError();
  return s;
}

export type KeyPurpose = "pick" | "phone" | "otp" | "id";

function key(purpose: KeyPurpose): Buffer {
  return createHmac("sha256", rootSecret()).update(`pingo:messaging:${purpose}:v1`).digest();
}

export function hmacHex(purpose: KeyPurpose, data: string): string {
  return createHmac("sha256", key(purpose)).update(data).digest("hex");
}

const b64u = (b: Buffer) => b.toString("base64url");
const unb64u = (s: string) => Buffer.from(s, "base64url");

function sameBytes(a: Buffer, b: Buffer) {
  return a.length === b.length && timingSafeEqual(a, b);
}

// ---------------------------------------------------------------------------
// Pick-time token: [version 1B][call uuid 16B][expiry unix seconds 4B][HMAC 16B] → 50 base64url chars.
// ---------------------------------------------------------------------------
const PICK_VERSION = 1;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const PICK_TOKEN_TTL_S = 72 * 3600;

export type TokenCheck<T> = { ok: true; value: T } | { ok: false; reason: "invalid" | "expired" };

export function signPickToken(callId: string, now: Date = new Date(), ttlS = PICK_TOKEN_TTL_S): string {
  if (!UUID_RE.test(callId)) throw new Error("bad call id");
  const body = Buffer.alloc(21);
  body.writeUInt8(PICK_VERSION, 0);
  Buffer.from(callId.replace(/-/g, ""), "hex").copy(body, 1);
  body.writeUInt32BE(Math.floor(now.getTime() / 1000) + ttlS, 17);
  const sig = createHmac("sha256", key("pick")).update(body).digest().subarray(0, 16);
  return b64u(Buffer.concat([body, sig]));
}

export function verifyPickToken(token: unknown, now: Date = new Date()): TokenCheck<{ callId: string; exp: Date }> {
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{50}$/.test(token)) return { ok: false, reason: "invalid" };
  const raw = unb64u(token);
  if (raw.length !== 37 || b64u(raw) !== token) return { ok: false, reason: "invalid" }; // canonical encoding only
  const body = raw.subarray(0, 21);
  const sig = raw.subarray(21);
  const want = createHmac("sha256", key("pick")).update(body).digest().subarray(0, 16);
  if (!sameBytes(sig, want) || body.readUInt8(0) !== PICK_VERSION) return { ok: false, reason: "invalid" };
  const hex = body.subarray(1, 17).toString("hex");
  const callId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  const exp = new Date(body.readUInt32BE(17) * 1000);
  if (exp.getTime() <= now.getTime()) return { ok: false, reason: "expired" };
  return { ok: true, value: { callId, exp } };
}

// ---------------------------------------------------------------------------
// Verified-phone token (returned by OTP verify, required by the apply route).
// payload = {p: phone hash, j: job id, e: expiry unix s}; token = b64u(json).b64u(hmac)
// ---------------------------------------------------------------------------
export const PHONE_TOKEN_TTL_S = 30 * 60;

export function signPhoneToken(phoneHash: string, jobId: string, now: Date = new Date(), ttlS = PHONE_TOKEN_TTL_S): string {
  const payload = b64u(Buffer.from(JSON.stringify({ p: phoneHash, j: jobId, e: Math.floor(now.getTime() / 1000) + ttlS })));
  const sig = b64u(createHmac("sha256", key("phone")).update(payload).digest());
  return `${payload}.${sig}`;
}

export function verifyPhoneToken(token: unknown, now: Date = new Date()): TokenCheck<{ phoneHash: string; jobId: string }> {
  if (typeof token !== "string" || token.length > 400) return { ok: false, reason: "invalid" };
  const [payload, sig, extra] = token.split(".");
  if (!payload || !sig || extra !== undefined) return { ok: false, reason: "invalid" };
  const want = createHmac("sha256", key("phone")).update(payload).digest();
  if (!sameBytes(unb64u(sig), want)) return { ok: false, reason: "invalid" };
  let v: { p?: unknown; j?: unknown; e?: unknown };
  try {
    v = JSON.parse(unb64u(payload).toString("utf8"));
  } catch {
    return { ok: false, reason: "invalid" };
  }
  if (typeof v.p !== "string" || typeof v.j !== "string" || typeof v.e !== "number") return { ok: false, reason: "invalid" };
  if (v.e * 1000 <= now.getTime()) return { ok: false, reason: "expired" };
  return { ok: true, value: { phoneHash: v.p, jobId: v.j } };
}

/** Lookup hash for a phone number (E.164). */
export const phoneHash = (phoneE164: string) => hmacHex("id", `phone:${phoneE164}`);
/** OTP code hash, bound to the phone and job. */
export const otpHash = (phoneHashHex: string, jobId: string, code: string) => hmacHex("otp", `${phoneHashHex}:${jobId}:${code}`);
