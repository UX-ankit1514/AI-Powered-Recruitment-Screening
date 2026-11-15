import { createHash, timingSafeEqual } from "node:crypto";
import { BOLNA_IPS } from "./config";

/** Constant-time string comparison (hashes first so lengths never leak). */
export function safeEqual(given: string | null | undefined, expected: string | null | undefined): boolean {
  if (!given || !expected) return false;
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

/** First hop of x-forwarded-for (set by Vercel), else x-real-ip. */
export function clientIp(req: Request): string | null {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim() || null;
  return req.headers.get("x-real-ip")?.trim() || null;
}

/**
 * Best-effort source check for Bolna callbacks. Rejects only when a client IP is known and it
 * is not one of Bolna's published IPs. Set BOLNA_IP_CHECK=off to disable (e.g. if Bolna adds IPs).
 */
export function bolnaIpAllowed(req: Request): boolean {
  if (process.env.BOLNA_IP_CHECK === "off") return true;
  const ip = clientIp(req);
  if (!ip) return true;
  return BOLNA_IPS.includes(ip);
}
