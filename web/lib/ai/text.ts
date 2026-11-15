/**
 * Unicode-aware text helpers (pure; safe anywhere). Used for quote verification and anonymisation.
 * Built with `new RegExp` so Unicode property escapes don't depend on the TS target.
 */

const NON_WORD = new RegExp("[^\\p{L}\\p{M}\\p{N}\\s]", "gu"); // drop punctuation, symbols, ZW joiners, danda
const SPACES = new RegExp("\\s+", "gu");

/**
 * Normalise for "same words" comparison: NFKC, lowercase, curly/straight quotes and all punctuation
 * removed, whitespace collapsed. Combining marks (Devanagari matras, viramas) are KEPT so Hindi words
 * keep their identity; zero-width joiners are dropped (they vary between transcribers).
 */
export function normaliseText(s: unknown): string {
  return String(s ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(NON_WORD, "")
    .replace(SPACES, " ")
    .trim();
}

const SPEAKER = /^\s*\[?\s*([A-Za-z][A-Za-z _-]{0,20}?)\s*\]?\s*[:：]\s?(.*)$/;
const CANDIDATE_LABELS = new Set(["user", "candidate", "human", "customer", "caller", "applicant"]);
const AGENT_LABELS = new Set(["assistant", "agent", "bot", "ai", "aditi", "interviewer", "system"]);

/**
 * Candidate's own words if the transcript has speaker labels ("assistant: … / user: …", Bolna's format);
 * otherwise the whole transcript. Unlabelled lines continue the previous speaker's turn.
 */
export function candidateText(transcript: string): string {
  const lines = String(transcript ?? "").split(/\r?\n/);
  let speaker: "candidate" | "agent" | null = null;
  let sawLabels = false;
  const out: string[] = [];
  for (const line of lines) {
    const m = SPEAKER.exec(line);
    const label = m?.[1]?.trim().toLowerCase();
    if (m && label && (CANDIDATE_LABELS.has(label) || AGENT_LABELS.has(label))) {
      sawLabels = true;
      speaker = CANDIDATE_LABELS.has(label) ? "candidate" : "agent";
      if (speaker === "candidate") out.push(m[2] ?? "");
    } else if (speaker === "candidate") {
      out.push(line);
    }
  }
  return sawLabels && out.join("").trim() ? out.join("\n") : String(transcript ?? "");
}

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Count words (Unicode-aware) and clip to `max` words. */
export function clipWords(s: string, max: number): string {
  const words = String(s ?? "").trim().split(/\s+/).filter(Boolean);
  return words.length <= max ? words.join(" ") : words.slice(0, max).join(" ").replace(/[,;:]$/, "") + "…";
}

export function clip(s: unknown, max: number): string {
  return String(s ?? "").trim().slice(0, max);
}
