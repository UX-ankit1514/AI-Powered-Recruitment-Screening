/**
 * E.164 normalisation. India is the default country:
 *   9876543210 / 09876543210 / 919876543210 / +91 98765-43210 -> +919876543210
 * Indian numbers must be mobiles (start 6-9). Other countries must arrive with "+" or "00".
 */
export type PhoneResult = { ok: true; phone: string } | { ok: false; reason: string };

export function normalizePhone(raw: unknown): PhoneResult {
  const input = String(raw ?? "").trim();
  if (!input) return { ok: false, reason: "missing phone" };
  if (/[a-z]/i.test(input.replace(/\s*(ext\.?|x)\s*\d+$/i, ""))) return { ok: false, reason: "phone has letters" };

  let p = input.replace(/[\s\-().\/]/g, "");
  if (p.startsWith("00")) p = `+${p.slice(2)}`;
  if (!/^\+?\d+$/.test(p)) return { ok: false, reason: "not a phone number" };

  if (!p.startsWith("+")) {
    if (/^\d{10}$/.test(p)) p = `+91${p}`;
    else if (/^0\d{10}$/.test(p)) p = `+91${p.slice(1)}`;
    else if (/^91\d{10}$/.test(p)) p = `+${p}`;
    else return { ok: false, reason: "need a 10-digit Indian mobile or a +country code" };
  }

  if (p.startsWith("+91")) {
    // tolerate a trunk zero after the country code: +91 0XXXXXXXXXX
    if (/^\+910\d{10}$/.test(p)) p = `+91${p.slice(4)}`;
    if (!/^\+91[6-9]\d{9}$/.test(p)) return { ok: false, reason: "not a valid Indian mobile" };
    return { ok: true, phone: p };
  }

  if (!/^\+[1-9]\d{7,14}$/.test(p)) return { ok: false, reason: "not a valid international number" };
  return { ok: true, phone: p };
}
