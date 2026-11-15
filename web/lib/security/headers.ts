/**
 * Security headers for every response (wired in next.config.ts).
 *
 * CSP notes:
 *  - script-src keeps 'unsafe-inline' because Next.js inlines its bootstrap/RSC payload scripts and
 *    this app uses Partial Prerendering (a per-request nonce would force every page dynamic).
 *    External scripts are limited to our origin + jsDelivr (Bolna Web Call SDK, pinned + SRI).
 *  - connect-src allows Supabase (REST/Auth/Storage over https, Realtime over wss), Bolna's API and
 *    any wss: host, because the Bolna web-call session hands the browser a per-call SIP websocket URL
 *    whose host is not fixed. WebRTC media itself is not governed by CSP.
 *  - media-src allows https: for call recordings (Bolna-hosted URLs, Supabase signed URLs).
 *  - fonts are self-hosted by next/font, so no Google Fonts origin is needed at runtime.
 */
export function contentSecurityPolicy(opts: { supabaseUrl?: string; dev?: boolean } = {}): string {
  let supabase = "";
  try {
    if (opts.supabaseUrl) supabase = new URL(opts.supabaseUrl).host;
  } catch {
    supabase = "";
  }
  const connect = ["'self'", "https://api.bolna.ai", "https://cdn.jsdelivr.net", "wss:"];
  if (supabase) connect.push(`https://${supabase}`, `wss://${supabase}`);
  if (opts.dev) connect.push("ws:", "http://localhost:*");

  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", ...(opts.dev ? ["'unsafe-eval'"] : [])],
    "style-src": ["'self'", "'unsafe-inline'"],
    "font-src": ["'self'", "data:"],
    "img-src": ["'self'", "data:", "blob:"],
    "media-src": ["'self'", "blob:", "https:"],
    "connect-src": connect,
    "worker-src": ["'self'", "blob:"],
    "frame-src": ["'none'"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"],
  };
  const parts = Object.entries(directives).map(([k, v]) => `${k} ${v.join(" ")}`);
  if (!opts.dev) parts.push("upgrade-insecure-requests");
  return parts.join("; ");
}

export function securityHeaders(opts: { supabaseUrl?: string; dev?: boolean } = {}): { key: string; value: string }[] {
  return [
    { key: "Content-Security-Policy", value: contentSecurityPolicy(opts) },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    // Microphone is needed for the in-browser interview call; nothing else.
    { key: "Permissions-Policy", value: "camera=(), microphone=(self), geolocation=(), payment=(), usb=()" },
    { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  ];
}
