/**
 * CSRF defence for cookie-authenticated state-changing routes.
 *
 * Session cookies are SameSite=Lax (so browsers already omit them on cross-site POSTs), and this
 * check adds a second, explicit layer: a browser request to /api/* or /auth/* with an unsafe method
 * must come from our own origin. Browsers always send `Origin` on cross-origin POST/PUT/DELETE and
 * `Sec-Fetch-Site` on modern engines; requests with neither are not from a browser page, so they
 * carry no ambient-cookie CSRF risk and pass (their auth is checked by the route as usual).
 *
 * Exempt: machine-to-machine routes authenticated by a secret, not a cookie (Bolna webhook +
 * function, dispatcher) and the public apply form (no session involved).
 */
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const EXEMPT_PREFIXES = ["/api/webhooks/", "/api/bolna/", "/api/dispatch", "/api/apply/"];
const GUARDED_PREFIXES = ["/api/", "/auth/"];

function originOf(url: string | undefined | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

export type OriginCheckInput = { method: string; url: string; headers: Headers };

/** True when the request must be refused as cross-site. */
export function isCrossSiteWrite(req: OriginCheckInput, appBaseUrl = process.env.APP_BASE_URL): boolean {
  if (SAFE_METHODS.has(req.method.toUpperCase())) return false;
  const url = new URL(req.url);
  const path = url.pathname;
  if (!GUARDED_PREFIXES.some((p) => path.startsWith(p))) return false;
  if (EXEMPT_PREFIXES.some((p) => path === p.replace(/\/$/, "") || path.startsWith(p))) return false;

  const allowed = new Set([url.origin, originOf(appBaseUrl)].filter(Boolean) as string[]);
  const origin = req.headers.get("origin");
  if (origin) return origin === "null" || !allowed.has(origin);

  const site = req.headers.get("sec-fetch-site");
  if (site) return site !== "same-origin" && site !== "none";
  return false;
}
