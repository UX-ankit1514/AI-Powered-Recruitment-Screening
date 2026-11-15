/**
 * Replace a candidate's name with "Candidate" before text goes to the scoring model, so the
 * evaluator never sees (and can't be biased by) the name. Pure; safe anywhere.
 */
import { escapeRegExp } from "./text";

const LETTER = "[\\p{L}\\p{M}\\p{N}]";

export function anonymise(text: string, name: string | null | undefined, replacement = "Candidate"): string {
  if (!text || !name || !name.trim()) return text ?? "";
  const full = name.normalize("NFKC").trim().replace(/\s+/g, " ");
  // Full name first, then each token of 2+ letters (first name, surname). Skip honorific-like tokens.
  const skip = new Set(["mr", "mrs", "ms", "dr", "shri", "smt", "kumar", "kumari"]);
  const tokens = full
    .split(" ")
    .map((t) => t.replace(/[.,]/g, ""))
    .filter((t) => t.length >= 2 && !skip.has(t.toLowerCase()));
  const parts = [full, ...tokens].filter((v, i, a) => a.indexOf(v) === i).sort((a, b) => b.length - a.length);
  let out = text.normalize("NFKC");
  for (const p of parts) {
    const re = new RegExp(`(?<!${LETTER})${escapeRegExp(p).replace(/ /g, "\\s+")}(?!${LETTER})`, "giu");
    out = out.replace(re, replacement);
  }
  // "Candidate Candidate" (first + last replaced separately) → "Candidate"
  return out.replace(new RegExp(`${replacement}(\\s+${replacement})+`, "g"), replacement);
}
