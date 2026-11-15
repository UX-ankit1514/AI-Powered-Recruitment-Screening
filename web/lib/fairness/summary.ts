/**
 * Bias watch summary (pure; no I/O). Reuses the ranking maths in lib/ai/scoring-math.ts, so a
 * group's average is computed exactly like the scores HR sees, with the job's CURRENT weights.
 *
 * Flag rule (deliberately simple, "significance-light"):
 *   A group is FLAGGED when it has at least MIN_GROUP_N (8) scored candidates AND its average
 *   overall is at least FLAG_GAP (10) points below the whole job's average.
 *   A smaller group (3–7) that is 10+ points below is shown as "watch": too few people to call it
 *   a pattern yet. Groups under 3 are "too few". These are signals for a human to review, never
 *   proof of bias, and nothing is changed automatically.
 */
import { computeOverall, pickFor, type QualitiesLike, type WeightsLike } from "@/lib/ai/scoring-math";
import { callQualityBucket, LANGUAGE_LABELS, languageMix, regionBucket, REGION_UNKNOWN, sourceBucket, type LanguageMix } from "./groups";

export const MIN_GROUP_N = 8;
export const WATCH_MIN_N = 3;
export const FLAG_GAP = 10;

export type BiasInputRow = {
  candidate_id: string;
  source: string | null;
  location: string | null;
  qualities: unknown;
  must_have_results: unknown;
  short_exit: boolean | null;
  language_mix: string | null;
  hr_review: string | null;
  outcome: string | null;
  duration_s: number | null;
  transcript_for_mix?: string | null;
};

export type GroupStatus = "flag" | "watch" | "ok" | "too_few";

export type GroupStat = {
  key: string;
  label: string;
  n: number;
  /** Mean overall 0–100, one decimal. */
  mean: number;
  /** mean − job mean, one decimal (negative = below average). */
  gap: number;
  /** Share (0–1) whose pick is Amazing or Good. */
  shareGood: number;
  /** Share (0–1) that took the short exit. */
  shortExitRate: number;
  status: GroupStatus;
};

export type DimensionKey = "language" | "region" | "source" | "call_quality";

export type DimensionSummary = {
  key: DimensionKey;
  label: string;
  question: string;
  groups: GroupStat[];
};

export type BiasAlert = {
  dimension: DimensionKey;
  dimensionLabel: string;
  group: string;
  n: number;
  mean: number;
  gap: number;
};

export type BiasSummary = {
  job: { id: string; title: string };
  rule: { minGroupN: number; flagGap: number; watchMinN: number };
  overall: { n: number; mean: number | null; shareGood: number; shortExitRate: number };
  /** Candidates with a score row but nothing weighted to judge on. */
  unscored: number;
  dimensions: DimensionSummary[];
  alerts: BiasAlert[];
};

const DIMENSIONS: { key: DimensionKey; label: string; question: string }[] = [
  {
    key: "language",
    label: "Language on the call",
    question: "Do people who answered in Hinglish or another language score lower than those who spoke English?",
  },
  { key: "region", label: "Where they live", question: "Do candidates from some cities or states score lower?" },
  { key: "source", label: "How they applied", question: "Does the way someone reached us change how they score?" },
  { key: "call_quality", label: "Call quality", question: "Are people on bad or cut-short calls scored lower for it?" },
];

/** Groups that mean "we don't know" sort last. */
const LAST = new Set([LANGUAGE_LABELS.unknown, REGION_UNKNOWN, "Other", "Other places"]);

type Scored = { overall: number; good: boolean; shortExit: boolean; groups: Record<DimensionKey, string> };

const round1 = (x: number) => Math.round(x * 10) / 10;

export function statusFor(n: number, gap: number): GroupStatus {
  const below = gap <= -FLAG_GAP;
  if (n >= MIN_GROUP_N) return below ? "flag" : "ok";
  if (n >= WATCH_MIN_N && below) return "watch";
  return n >= WATCH_MIN_N ? "ok" : "too_few";
}

function readLanguage(stored: string | null, transcript: string | null | undefined): LanguageMix | null {
  if (stored === "english" || stored === "hinglish" || stored === "other") return stored;
  return languageMix(transcript ?? null);
}

export function groupsFor(r: BiasInputRow): Record<DimensionKey, string> {
  const lang = readLanguage(r.language_mix, r.transcript_for_mix);
  return {
    language: LANGUAGE_LABELS[lang ?? "unknown"],
    region: regionBucket(r.location),
    source: sourceBucket(r.source),
    call_quality: callQualityBucket(r),
  };
}

function stats(rows: Scored[]) {
  const n = rows.length;
  if (!n) return { n, mean: null, shareGood: 0, shortExitRate: 0 };
  let sum = 0;
  let good = 0;
  let se = 0;
  for (const r of rows) {
    sum += r.overall;
    if (r.good) good++;
    if (r.shortExit) se++;
  }
  return { n, mean: sum / n, shareGood: good / n, shortExitRate: se / n };
}

export function summarizeBias(
  job: { id: string; title: string },
  rows: BiasInputRow[],
  weights: WeightsLike | null | undefined,
): BiasSummary {
  const scored: Scored[] = [];
  let unscored = 0;
  for (const r of rows) {
    const overall = computeOverall(r.qualities as QualitiesLike, weights);
    if (overall === null) {
      unscored++;
      continue;
    }
    const mhr = Array.isArray(r.must_have_results) ? (r.must_have_results as { met: boolean | "unknown" | null }[]) : null;
    const pick = pickFor(overall, { short_exit: r.short_exit, must_have_results: mhr });
    scored.push({ overall, good: pick === "amazing" || pick === "good", shortExit: !!r.short_exit, groups: groupsFor(r) });
  }

  const all = stats(scored);
  const jobMean = all.mean ?? 0;
  const alerts: BiasAlert[] = [];

  const dimensions = DIMENSIONS.map((d) => {
    const by = new Map<string, Scored[]>();
    for (const s of scored) {
      const g = s.groups[d.key];
      by.set(g, [...(by.get(g) ?? []), s]);
    }
    const groups: GroupStat[] = [...by.entries()].map(([label, list]) => {
      const st = stats(list);
      const mean = st.mean ?? 0;
      const gap = mean - jobMean;
      return {
        key: label
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "_")
          .replace(/^_|_$/g, ""),
        label,
        n: st.n,
        mean: round1(mean),
        gap: round1(gap),
        shareGood: st.shareGood,
        shortExitRate: st.shortExitRate,
        status: statusFor(st.n, gap),
      };
    });
    groups.sort((a, b) => Number(LAST.has(a.label)) - Number(LAST.has(b.label)) || b.n - a.n || a.label.localeCompare(b.label));
    for (const g of groups) {
      if (g.status === "flag") alerts.push({ dimension: d.key, dimensionLabel: d.label, group: g.label, n: g.n, mean: g.mean, gap: g.gap });
    }
    return { ...d, groups };
  });

  alerts.sort((a, b) => a.gap - b.gap);
  return {
    job,
    rule: { minGroupN: MIN_GROUP_N, flagGap: FLAG_GAP, watchMinN: WATCH_MIN_N },
    overall: { n: all.n, mean: all.mean === null ? null : round1(all.mean), shareGood: all.shareGood, shortExitRate: all.shortExitRate },
    unscored,
    dimensions,
    alerts,
  };
}
