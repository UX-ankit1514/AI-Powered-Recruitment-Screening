const BASE = "https://pingo.invalid";

/**
 * Only allow same-site relative redirects ("/x"), never "//evil.com", "/\evil.com", absolute URLs,
 * or tricks the URL parser normalises into those (tabs/newlines/control chars are stripped by
 * browsers and by `new URL`, so "/\t/evil.com" would otherwise become "//evil.com").
 */
export function safeNext(next: string | null | undefined, fallback = "/dashboard") {
  if (!next || next.length > 2048) return fallback;
  if (/[\u0000-\u001f\u007f\s\\]/.test(next)) return fallback;
  if (!next.startsWith("/") || next.startsWith("//")) return fallback;
  try {
    const u = new URL(next, BASE);
    if (u.origin !== BASE) return fallback;
    return `${u.pathname}${u.search}${u.hash}`;
  } catch {
    return fallback;
  }
}
