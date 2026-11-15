import { createHash, timingSafeEqual } from "node:crypto";
import { BOLNA_IPS } from "./config";

/** Constant-time string comparison (hashes first so lengths never leak). */
export function safeEqual(given: string | null | undefined, expected: string | null | undefined): boolean {
  if (!given || !expected) return false;
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

/**
 * Client IP. On Vercel, x-forwarded-for is set by the platform (any client-sent value is
 * overwritten), so its first hop is the real caller. Behind a proxy that appends instead of
 * overwriting, this would be spoofable: keep the secret check as the primary control.
 */
export function clientIp(req: Request): string | null {
  const xff = req.headers.get("x-forwarded-for");
  const raw = xff ? xff.split(",")[0]!.trim() : req.headers.get("x-real-ip")?.trim();
  if (!raw) return null;
  return raw.replace(/^::ffff:/i, ""); // IPv4-mapped IPv6
}

/**
 * Allowed Bolna source IPs. Configure with BOLNA_IP_ALLOWLIST (comma-separated IPs); unset means
 * Bolna's three published IPs (config.ts). BOLNA_IP_ALLOWLIST=off (or the older BOLNA_IP_CHECK=off)
 * disables the check, e.g. while Bolna rolls out a new IP. Returns null when disabled.
 */
export function bolnaAllowlist(): string[] | null {
  const raw = process.env.BOLNA_IP_ALLOWLIST?.trim();
  if (process.env.BOLNA_IP_CHECK === "off" || raw?.toLowerCase() === "off") return null;
  if (!raw) return BOLNA_IPS;
  const list = raw.split(",").map((s) => s.trim()).filter(Boolean);
  return list.length ? list : BOLNA_IPS;
}

/**
 * Source check for Bolna callbacks (webhook + reschedule function), on top of the secret.
 * A caller IP outside the allowlist is rejected. When the IP is unknown: rejected on Vercel
 * (the platform always sets it, so a missing IP means something is wrong), allowed elsewhere
 * (local dev / tests have no proxy).
 */
export function bolnaIpAllowed(req: Request): boolean {
  const list = bolnaAllowlist();
  if (!list) return true;
  const ip = clientIp(req);
  if (!ip) return !process.env.VERCEL;
  return list.includes(ip);
}
