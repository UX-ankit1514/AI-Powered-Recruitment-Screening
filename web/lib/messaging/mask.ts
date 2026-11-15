/** Display masking for personal data in the admin message log. Pure. */

/** "+919876543210" → "+91 98••• ••210"; other countries keep the code and the last 3 digits. */
export function maskPhone(e164: string): string {
  const m = /^\+(\d+)$/.exec(e164 ?? "");
  if (!m) return "••••";
  const d = m[1]!;
  if (d.startsWith("91") && d.length === 12) return `+91 ${d.slice(2, 4)}••• ••${d.slice(-3)}`;
  const ccLen = d.length > 10 ? d.length - 10 : 1;
  return `+${d.slice(0, ccLen)} ••••••${d.slice(-3)}`;
}

/** Hides time-pick link tokens and any 4–8 digit code in a stored body. */
export function maskBody(body: string): string {
  return String(body ?? "")
    .replace(/(\/pick-time\/)[A-Za-z0-9_-]+/g, "$1•••")
    .replace(/\b\d{4,8}\b/g, (s) => "•".repeat(s.length));
}
