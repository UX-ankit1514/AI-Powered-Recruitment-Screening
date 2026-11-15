/**
 * Pure results maths + shapes shared by the results pages, their API routes and the CSV export.
 * No I/O, safe on server and client.
 *
 * Overall and pick are computed at read time from the stored per-quality scores and the chosen
 * rubric weights (lib/ai/scoring-math). A recruiter's override is the latest `override` action;
 * it lives in the audit log, not on the score, so it survives a re-score.
 */
import { computeOverall, hasFailedMustHave, pickFor, type PickValue } from "@/lib/ai/scoring-math";
import { readFlags, type Flags, type CallSummary } from "@/components/candidate-format";
import type { CallOutcome, CallState } from "@/lib/types";

export const PICKS = ["amazing", "good", "maybe", "no"] as const;
export const isPick = (v: unknown): v is PickValue => typeof v === "string" && (PICKS as readonly string[]).includes(v);

export type QualityEntry = { score: number | null; reason: string; quotes: { text: string; ts: number | string | null }[] };
export type MustHaveEntry = { text: string; met: boolean | "unknown"; quote: string | null };
export type Mismatch = { claim_quote: string; resume_line: string };

export type OverrideInfo = { pick: PickValue; note: string | null; at: string };

/** One row of a ranked job (GET /api/jobs/:id/ranking, candidates table, export). */
export type RankRow = {
  candidate: { id: string; name: string; source: string; status: string; job_id: string };
  status: string;
  scored: boolean;
  /** Pick from the score alone (null when not scored). */
  scored_pick: PickValue | null;
  /** What the team sees: the override when there is one, else scored_pick. */
  pick: PickValue | null;
  override: OverrideInfo | null;
  overall: number | null;
  /** Why the pick is held at Maybe, if it is. */
  held: "call ended early" | "must-have not met" | null;
  resume_only_score: number | null;
  qualities: Record<string, QualityEntry>;
  must_have_results: MustHaveEntry[];
  flags: Flags;
  mismatches: Mismatch[];
  summary: string;
  short_exit: boolean;
  call: CallSummary | null;
};

const str = (v: unknown) => (typeof v === "string" ? v : "");

export function readQualities(raw: unknown): Record<string, QualityEntry> {
  const out: Record<string, QualityEntry> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const q = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
    const s = q.score;
    const quotes = Array.isArray(q.quotes)
      ? q.quotes
          .map((x) => {
            if (typeof x === "string") return { text: x, ts: null };
            const o = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
            const ts = typeof o.ts === "number" || typeof o.ts === "string" ? o.ts : null;
            return { text: str(o.text), ts };
          })
          .filter((x) => x.text)
      : [];
    out[k] = {
      score: typeof s === "number" && s >= 1 && s <= 5 ? s : null,
      reason: str(q.reason),
      quotes,
    };
  }
  return out;
}

export function readMustHaves(raw: unknown): MustHaveEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((m) => {
      const o = (m && typeof m === "object" ? m : {}) as Record<string, unknown>;
      const met = o.met === true ? true : o.met === false ? false : ("unknown" as const);
      return { text: str(o.text), met, quote: str(o.quote) || null };
    })
    .filter((m) => m.text);
}

export function readMismatches(raw: unknown): Mismatch[] {
  const f = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  if (!Array.isArray(f.resume_mismatch)) return [];
  return f.resume_mismatch
    .map((m) => {
      if (typeof m === "string") return { claim_quote: m, resume_line: "" };
      const o = (m && typeof m === "object" ? m : {}) as Record<string, unknown>;
      return { claim_quote: str(o.claim_quote), resume_line: str(o.resume_line) };
    })
    .filter((m) => m.claim_quote || m.resume_line);
}

/** Latest override per candidate from `override` actions (oldest → newest). `pick: null` clears. */
export function latestOverrides(
  actions: { candidate_id: string; new_value: unknown; note: string | null; at: string }[],
): Map<string, OverrideInfo> {
  const sorted = [...actions].sort((a, b) => a.at.localeCompare(b.at));
  const out = new Map<string, OverrideInfo>();
  for (const a of sorted) {
    const v = (a.new_value && typeof a.new_value === "object" ? a.new_value : {}) as Record<string, unknown>;
    if (isPick(v.pick)) out.set(a.candidate_id, { pick: v.pick, note: a.note, at: a.at });
    else out.delete(a.candidate_id);
  }
  return out;
}

export type ScoreLike = {
  qualities: unknown;
  must_have_results: unknown;
  flags: unknown;
  summary: string | null;
  short_exit: boolean | null;
} | null;

export function evaluate(
  score: ScoreLike,
  weights: Record<string, number>,
  override: OverrideInfo | null,
): Pick<RankRow, "scored" | "scored_pick" | "pick" | "override" | "overall" | "held" | "qualities" | "must_have_results" | "flags" | "mismatches" | "summary" | "short_exit"> {
  const qualities = readQualities(score?.qualities);
  const mustHaves = readMustHaves(score?.must_have_results);
  const shortExit = score?.short_exit === true;
  const overall = score ? computeOverall(qualities, weights) : null;
  const scoredPick = pickFor(overall, { short_exit: shortExit, must_have_results: mustHaves });
  const uncapped = pickFor(overall);
  let held: RankRow["held"] = null;
  if (scoredPick === "maybe" && (uncapped === "amazing" || uncapped === "good")) {
    held = shortExit ? "call ended early" : hasFailedMustHave({ must_have_results: mustHaves }) ? "must-have not met" : null;
  }
  return {
    scored: Boolean(score),
    scored_pick: scoredPick,
    pick: override?.pick ?? scoredPick,
    override,
    overall,
    held,
    qualities,
    must_have_results: mustHaves,
    flags: readFlags(score?.flags),
    mismatches: readMismatches(score?.flags),
    summary: score?.summary ?? "",
    short_exit: shortExit,
  };
}

const ORDER: Record<PickValue, number> = { amazing: 0, good: 1, maybe: 2, no: 3 };
const STATUS_ORDER: Record<string, number> = { shortlisted: 0, rejected: 2, ats_filtered: 3 };

/** Sorted by: ATS-filtered last, pick, overall desc, name. */
export function sortRows<T extends Pick<RankRow, "pick" | "overall" | "status"> & { candidate: { name: string } }>(rows: T[]): T[] {
  return [...rows].sort(
    (a, b) =>
      Number(a.status === "ats_filtered") - Number(b.status === "ats_filtered") ||
      (a.pick ? ORDER[a.pick] : 9) - (b.pick ? ORDER[b.pick] : 9) ||
      (b.overall ?? -1) - (a.overall ?? -1) ||
      (STATUS_ORDER[a.status] ?? 1) - (STATUS_ORDER[b.status] ?? 1) ||
      a.candidate.name.localeCompare(b.candidate.name),
  );
}

/** Latest call per candidate from rows ordered oldest → newest. */
export function latestCallMap(
  calls: { candidate_id: string; state: CallState; outcome: CallOutcome | null; duration_s: number | null; attempt: number }[],
): Map<string, CallSummary> {
  const m = new Map<string, CallSummary>();
  for (const c of calls) m.set(c.candidate_id, { state: c.state, outcome: c.outcome, durationS: c.duration_s, attempt: c.attempt });
  return m;
}

/** "Resume 42 → Call 81 (+39)" pieces; null parts when unknown. */
export function resumeGap(resume: number | null, overall: number | null) {
  const r = typeof resume === "number" ? Math.round(resume) : null;
  const delta = r !== null && typeof overall === "number" ? overall - r : null;
  return { resume: r, call: overall, delta };
}

/** A resume screen would have dropped them, the call says otherwise. */
export function resumeWouldDrop(resume: number | null, overall: number | null) {
  return typeof resume === "number" && resume < 50 && typeof overall === "number" && overall >= 65;
}

// ---------- CSV ----------
const csvCell = (v: unknown) => {
  let s = v === null || v === undefined ? "" : String(v);
  // Formula injection guard for spreadsheet apps.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function rowsToCsv(rows: RankRow[], qualityKeys: { key: string; name: string }[]): string {
  const head = [
    "Rank",
    "Name",
    "Source",
    "Status",
    "Pick",
    "Pick changed by team",
    "Overall",
    "Resume score",
    ...qualityKeys.map((q) => q.name),
    "Must-haves not met",
    "Flags",
    "Summary",
  ];
  const lines = [head.map(csvCell).join(",")];
  rows.forEach((r, i) => {
    const f = r.flags;
    const flags = [
      f.otherRole ? `Fits another role: ${f.otherRole}` : "",
      f.cultureStandout ? "Culture standout" : "",
      f.wantsInternship ? "Wants internship" : "",
      f.resumeMismatch ? "Resume mismatch" : "",
      f.hrReview ? `HR review: ${f.hrReview}` : "",
    ].filter(Boolean);
    lines.push(
      [
        i + 1,
        r.candidate.name,
        r.candidate.source,
        r.status,
        r.pick ?? "",
        r.override ? "yes" : "",
        r.overall ?? "",
        r.resume_only_score === null ? "" : Math.round(r.resume_only_score),
        ...qualityKeys.map((q) => r.qualities[q.key]?.score ?? ""),
        r.must_have_results.filter((m) => m.met === false).map((m) => m.text).join("; "),
        flags.join("; "),
        r.summary,
      ]
        .map(csvCell)
        .join(","),
    );
  });
  return lines.join("\r\n") + "\r\n";
}

/** Client-side instant re-rank on other weights (no new scoring). Overrides are kept. */
export function rerank(rows: RankRow[], weights: Record<string, number>): RankRow[] {
  return sortRows(
    rows.map((r) => {
      if (!r.scored) return r;
      const overall = computeOverall(r.qualities, weights);
      const scoredPick = pickFor(overall, { short_exit: r.short_exit, must_have_results: r.must_have_results });
      const uncapped = pickFor(overall);
      const held: RankRow["held"] =
        scoredPick === "maybe" && (uncapped === "amazing" || uncapped === "good")
          ? r.short_exit
            ? "call ended early"
            : hasFailedMustHave({ must_have_results: r.must_have_results })
              ? "must-have not met"
              : null
          : null;
      return { ...r, overall, scored_pick: scoredPick, pick: r.override?.pick ?? scoredPick, held };
    }),
  );
}
