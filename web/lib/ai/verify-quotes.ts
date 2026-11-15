/**
 * Code check (not AI): every quote the model cites must really be in the candidate's words.
 * Matching ignores case, whitespace and punctuation (Unicode-aware, so Hinglish and Devanagari work).
 * A quality left with no verified quote loses its score (null = "no evidence"). Pure; safe anywhere.
 */
import { candidateText, normaliseText } from "./text";

type QuoteLike = string | { text: string; ts?: number | string | null };
type Verifiable = {
  qualities: Record<string, { score: number | null; reason: string; quotes: QuoteLike[] }>;
  must_have_results?: { text: string; met: boolean | "unknown"; quote: string | null }[];
  flags?: { resume_mismatch?: { claim_quote: string; resume_line: string }[] } & Record<string, unknown>;
};

export type VerifiedQuality = { score: number | null; reason: string; quotes: { text: string; ts: number | string | null }[] };

const MIN_QUOTE_CHARS = 3;

export function quoteFound(quote: string, haystackNormalised: string): boolean {
  const n = normaliseText(quote);
  return n.length >= MIN_QUOTE_CHARS && (` ${haystackNormalised} `).includes(` ${n} `);
}

export function verifyQuotes<T extends Verifiable>(
  score: T,
  transcript: string,
): Omit<T, "qualities"> & { qualities: Record<string, VerifiedQuality> } {
  // Prefer the candidate's own turns; fall back to the whole transcript if it has no speaker labels.
  const hay = normaliseText(candidateText(transcript));
  const qualities: Record<string, VerifiedQuality> = {};
  for (const [key, q] of Object.entries(score.qualities ?? {})) {
    const seen = new Set<string>();
    const quotes = (q?.quotes ?? [])
      .map((x) => (typeof x === "string" ? { text: x, ts: null } : { text: x?.text ?? "", ts: x?.ts ?? null }))
      .filter((x) => {
        const n = normaliseText(x.text);
        if (seen.has(n) || !quoteFound(x.text, hay)) return false;
        seen.add(n);
        return true;
      });
    const valid = typeof q?.score === "number" && Number.isInteger(q.score) && q.score >= 1 && q.score <= 5;
    qualities[key] = {
      score: valid && quotes.length > 0 ? q.score : null,
      reason: typeof q?.reason === "string" ? q.reason : "",
      quotes,
    };
  }
  const out = { ...score, qualities } as Omit<T, "qualities"> & { qualities: Record<string, VerifiedQuality> };

  // Must-haves: a true/false verdict needs a real quote; otherwise it's "unknown" (never cap a pick on an invented quote).
  if (Array.isArray(score.must_have_results)) {
    (out as unknown as Verifiable).must_have_results = score.must_have_results.map((r) => {
      const ok = typeof r.quote === "string" && quoteFound(r.quote, hay);
      return { text: r.text, met: ok ? r.met : "unknown", quote: ok ? r.quote : null };
    });
  }
  // Resume mismatch claims must quote the call.
  if (score.flags && Array.isArray(score.flags.resume_mismatch)) {
    (out as unknown as Verifiable).flags = {
      ...score.flags,
      resume_mismatch: score.flags.resume_mismatch.filter((m) => quoteFound(m.claim_quote, hay)),
    };
  }
  return out;
}
