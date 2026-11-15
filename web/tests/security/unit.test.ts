/** M9 unit tests (no network): redirects, CSRF origin check, headers/CSP, Bolna IP allowlist, cost, SDK pinning. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { safeNext } from "../../lib/safe-next";
import { isCrossSiteWrite } from "../../lib/security/origin";
import { contentSecurityPolicy, securityHeaders } from "../../lib/security/headers";
import { bolnaAllowlist, bolnaIpAllowed, clientIp, safeEqual } from "../../lib/calls/secret";
import { BOLNA_IPS } from "../../lib/calls/config";
import { formatCallCost, formatInrFromCents, formatUsdFromCents, fxInrPerUsd } from "../../lib/cost";
import { BOLNA_WEB_SDK, BOLNA_WEB_SDK_SRI } from "../../components/calls/bolna-web";

const root = join(__dirname, "../..");

describe("auth callback: no open redirects", () => {
  it("keeps same-site relative paths", () => {
    expect(safeNext("/candidates/abc?tab=calls")).toBe("/candidates/abc?tab=calls");
    expect(safeNext("/jobs#x")).toBe("/jobs#x");
  });
  it.each([
    "//evil.com",
    "/\\evil.com",
    "/\t/evil.com",
    "/\n/evil.com",
    "/%09/evil.com/../x",
    "https://evil.com",
    "javascript:alert(1)",
    "evil.com",
    " /x",
    "",
    null,
    undefined,
  ])("rejects %j", (bad) => {
    const out = safeNext(bad as string | null | undefined);
    expect(new URL(out, "https://app.example").origin).toBe("https://app.example");
    if (bad !== "/%09/evil.com/../x") expect(out).toBe("/dashboard");
  });
});

describe("CSRF: same-origin check for cookie-authenticated writes", () => {
  const req = (method: string, path: string, h: Record<string, string> = {}) => ({
    method,
    url: `https://pingo.example${path}`,
    headers: new Headers(h),
  });
  it("blocks a cross-site POST/PUT to /api and /auth", () => {
    expect(isCrossSiteWrite(req("POST", "/api/candidates/x/actions", { origin: "https://evil.example" }))).toBe(true);
    expect(isCrossSiteWrite(req("PUT", "/api/jobs/x/rubric", { origin: "https://evil.example" }))).toBe(true);
    expect(isCrossSiteWrite(req("POST", "/auth/signout", { origin: "https://evil.example" }))).toBe(true);
    expect(isCrossSiteWrite(req("POST", "/api/jobs", { origin: "null" }))).toBe(true);
    expect(isCrossSiteWrite(req("POST", "/api/jobs", { "sec-fetch-site": "cross-site" }))).toBe(true);
    expect(isCrossSiteWrite(req("POST", "/api/jobs", { "sec-fetch-site": "same-site" }))).toBe(true);
  });
  it("allows same-origin, the configured app URL, safe methods and non-browser clients", () => {
    expect(isCrossSiteWrite(req("POST", "/api/jobs", { origin: "https://pingo.example" }))).toBe(false);
    expect(isCrossSiteWrite(req("POST", "/api/jobs", { origin: "https://app.example" }), "https://app.example/")).toBe(false);
    expect(isCrossSiteWrite(req("POST", "/api/jobs", { "sec-fetch-site": "same-origin" }))).toBe(false);
    expect(isCrossSiteWrite(req("GET", "/api/jobs/x/export", { origin: "https://evil.example" }))).toBe(false);
    expect(isCrossSiteWrite(req("POST", "/api/jobs"))).toBe(false);
  });
  it("exempts secret-authenticated machine routes and the public apply form", () => {
    for (const p of ["/api/webhooks/bolna", "/api/bolna/reschedule", "/api/dispatch", "/api/apply/123"]) {
      expect(isCrossSiteWrite(req("POST", p, { origin: "https://bolna.example" })), p).toBe(false);
    }
  });
  it("is wired into the proxy before the session refresh", () => {
    const src = readFileSync(join(root, "proxy.ts"), "utf8");
    expect(src.indexOf("isCrossSiteWrite")).toBeGreaterThan(-1);
    expect(src.indexOf("isCrossSiteWrite(")).toBeLessThan(src.indexOf("updateSession(request)"));
  });
});

describe("security headers", () => {
  const csp = contentSecurityPolicy({ supabaseUrl: "https://abc.supabase.co" });
  const dir = (name: string) => csp.split("; ").find((d) => d.startsWith(`${name} `)) ?? "";
  it("CSP allows only what the app needs", () => {
    expect(dir("default-src")).toBe("default-src 'self'");
    expect(dir("script-src")).toContain("https://cdn.jsdelivr.net");
    expect(dir("script-src")).not.toContain("'unsafe-eval'");
    expect(dir("connect-src")).toContain("https://abc.supabase.co");
    expect(dir("connect-src")).toContain("wss://abc.supabase.co");
    expect(dir("connect-src")).toContain("https://api.bolna.ai");
    expect(dir("frame-ancestors")).toBe("frame-ancestors 'none'");
    expect(dir("object-src")).toBe("object-src 'none'");
    expect(csp).toContain("upgrade-insecure-requests");
  });
  it("sends the standard hardening headers", () => {
    const h = Object.fromEntries(securityHeaders().map((x) => [x.key, x.value]));
    expect(h["X-Frame-Options"]).toBe("DENY");
    expect(h["X-Content-Type-Options"]).toBe("nosniff");
    expect(h["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(h["Permissions-Policy"]).toContain("microphone=(self)");
    expect(h["Strict-Transport-Security"]).toMatch(/max-age=\d+/);
  });
  it("next.config applies them to every path", () => {
    const src = readFileSync(join(root, "next.config.ts"), "utf8");
    expect(src).toContain("securityHeaders(");
    expect(src).toContain('source: "/:path*"');
    expect(src).toContain("poweredByHeader: false");
  });
});

describe("Bolna source-IP allowlist (configurable)", () => {
  const saved = { list: process.env.BOLNA_IP_ALLOWLIST, check: process.env.BOLNA_IP_CHECK, vercel: process.env.VERCEL };
  afterEach(() => {
    for (const [k, v] of [["BOLNA_IP_ALLOWLIST", saved.list], ["BOLNA_IP_CHECK", saved.check], ["VERCEL", saved.vercel]] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });
  const from = (ip?: string) => new Request("https://x/api/webhooks/bolna", { method: "POST", headers: ip ? { "x-forwarded-for": `${ip}, 10.0.0.1` } : {} });

  it("defaults to Bolna's three published IPs", () => {
    delete process.env.BOLNA_IP_ALLOWLIST;
    delete process.env.BOLNA_IP_CHECK;
    expect(bolnaAllowlist()).toEqual(BOLNA_IPS);
    for (const ip of BOLNA_IPS) expect(bolnaIpAllowed(from(ip))).toBe(true);
    expect(bolnaIpAllowed(from("::ffff:13.203.39.153"))).toBe(true);
    expect(bolnaIpAllowed(from("203.0.113.9"))).toBe(false);
  });
  it("reads a custom list from BOLNA_IP_ALLOWLIST", () => {
    process.env.BOLNA_IP_ALLOWLIST = " 198.51.100.7 ,198.51.100.8";
    expect(bolnaIpAllowed(from("198.51.100.8"))).toBe(true);
    expect(bolnaIpAllowed(from("13.203.39.153"))).toBe(false);
  });
  it("can be switched off explicitly (and only explicitly)", () => {
    process.env.BOLNA_IP_ALLOWLIST = "off";
    expect(bolnaIpAllowed(from("203.0.113.9"))).toBe(true);
    process.env.BOLNA_IP_ALLOWLIST = "";
    expect(bolnaIpAllowed(from("203.0.113.9"))).toBe(false);
  });
  it("an unknown caller IP is refused on Vercel, allowed locally", () => {
    delete process.env.BOLNA_IP_ALLOWLIST;
    process.env.VERCEL = "1";
    expect(bolnaIpAllowed(from())).toBe(false);
    delete process.env.VERCEL;
    expect(bolnaIpAllowed(from())).toBe(true);
    expect(clientIp(from("1.2.3.4"))).toBe("1.2.3.4");
  });
});

describe("secret comparison is constant-time", () => {
  it("uses timingSafeEqual over fixed-length digests and rejects empties", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abcd")).toBe(false);
    expect(safeEqual("", "")).toBe(false);
    expect(safeEqual(null, "x")).toBe(false);
    const src = readFileSync(join(root, "lib/calls/secret.ts"), "utf8");
    expect(src).toContain("timingSafeEqual");
  });
  it("every secret-checked route goes through safeEqual (no ===)", () => {
    for (const f of ["lib/calls/webhook.ts", "lib/calls/reschedule.ts", "lib/calls/dispatch.ts"]) {
      const src = readFileSync(join(root, f), "utf8");
      expect(src, f).toContain("safeEqual(");
      expect(src, f).not.toMatch(/(SECRET|secret)\s*[!=]==/);
    }
  });
});

describe("call cost (Bolna reports USD cents)", () => {
  it("formats cents as dollars and derives rupees at the configured rate", () => {
    expect(formatUsdFromCents(950)).toBe("$9.50");
    expect(formatUsdFromCents(12)).toBe("$0.12");
    expect(formatInrFromCents(100, 88)).toBe("₹88");
    expect(formatCallCost(12_345, 88)).toEqual({ usd: "$123.45", inr: "₹10,864" });
  });
  it("FX rate comes from env with a safe default of 88", () => {
    expect(fxInrPerUsd(undefined)).toBe(88);
    expect(fxInrPerUsd("83.5")).toBe(83.5);
    expect(fxInrPerUsd("nonsense")).toBe(88);
    expect(fxInrPerUsd("-1")).toBe(88);
  });
  it("no screen formats raw cents as rupees any more", () => {
    const src = readFileSync(join(root, "components/dashboard/dashboard-view.tsx"), "utf8");
    expect(src).not.toContain("formatRupees");
    expect(src).toContain("formatCallCost(");
  });
});

describe("third-party script and server-only secrets", () => {
  it("the Bolna SDK is pinned to a version and loaded with SRI", () => {
    expect(BOLNA_WEB_SDK).toMatch(/@v\d+\.\d+\.\d+\//);
    expect(BOLNA_WEB_SDK_SRI).toMatch(/^sha384-[A-Za-z0-9+/=]{64}$/);
    expect(readFileSync(join(root, "components/calls/bolna-web.ts"), "utf8")).toContain("s.integrity = BOLNA_WEB_SDK_SRI");
  });
  it("the service-role client can never be bundled for the browser", () => {
    const src = readFileSync(join(root, "lib/supabase/admin.ts"), "utf8");
    expect(src.split("\n")[0]).toBe('import "server-only";');
  });
});
