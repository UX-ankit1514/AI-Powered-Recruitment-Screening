/**
 * Pure scoring maths shared by server and client (no server imports, no I/O).
 *
 * Overall (0–100) = weighted mean of the SCORED qualities with the rubric weights (renormalised over
 * qualities that have a score; "not covered" qualities are excluded, never penalised), mapped from
 * 1–5 to 0–100 as (avg − 1) / 4 × 100.
 *
 * Since eval-v1 each stored quality score already folds in the job's requirements mapped to it
 * (lib/ai/evaluate.ts → foldQuality):
 *     quality_q = Σ w·s / Σ w over { direct score of q (w = 2) } ∪ { requirement r with r.quality = q, except logistics (w = 3 must · 2 core · 1 nice) }
 * so the overall is requirement-weighted JD fit and rubric preference in one number, still re-weighted
 * instantly at read time.
 *
 * JD fit (0–100, shown separately) = computeJdFit: Σ w_r·s_r / Σ w_r over SCORED requirements
 * (w = 3 must · 2 core · 1 nice), mapped the same way.
 *
 * Pick cut-offs (unchanged): Amazing ≥80, Good ≥65, Maybe ≥45, else No. A failed must-have or a short
 * exit caps the pick at Maybe.
 */

export const PRESET_QUALITY_KEYS = [
  "skills",
  "experience",
  "confidence",
  "culture_fit",
  "curiosity",
  "learning_drive",
  "storytelling",
] as const;

export const CUTOFFS = { amazing: 80, good: 65, maybe: 45 } as const;

export type PickValue = "amazing" | "good" | "maybe" | "no";

export type ScoredQualityLike = { score: number | null | undefined } | null | undefined;
export type QualitiesLike = Record<string, ScoredQualityLike>;
export type WeightsLike = Record<string, number | null | undefined>;

export type PickFlags = {
  short_exit?: boolean | null;
  /** Explicit override; otherwise derived from must_have_results. */
  must_have_failed?: boolean | null;
  must_have_results?: ReadonlyArray<{ met: boolean | "unknown" | null | undefined }> | null;
};

function validScore(q: ScoredQualityLike): number | null {
  const s = q?.score;
  return typeof s === "number" && Number.isFinite(s) && s >= 1 && s <= 5 ? s : null;
}

/**
 * Weighted overall on 0–100, rounded to an integer. Returns null when no weighted quality has a score
 * (nothing to judge on). Negative/NaN weights count as 0.
 */
export function computeOverall(qualities: QualitiesLike | null | undefined, weights: WeightsLike | null | undefined): number | null {
  if (!qualities || !weights) return null;
  let sum = 0;
  let wsum = 0;
  for (const [key, raw] of Object.entries(weights)) {
    const w = typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? raw : 0;
    if (w === 0) continue;
    const s = validScore(qualities[key]);
    if (s === null) continue;
    sum += s * w;
    wsum += w;
  }
  if (wsum === 0) return null;
  const avg = sum / wsum;
  const overall = ((avg - 1) / 4) * 100;
  return Math.round(Math.min(100, Math.max(0, overall)));
}

export function hasFailedMustHave(flags: PickFlags | null | undefined): boolean {
  if (!flags) return false;
  if (flags.must_have_failed) return true;
  return (flags.must_have_results ?? []).some((r) => r?.met === false);
}

/** Pick from overall + caps. A null overall (nothing scored) returns null — "not scored", not "No". */
export function pickFor(overall: number | null | undefined, flags?: PickFlags | null): PickValue | null {
  if (typeof overall !== "number" || !Number.isFinite(overall)) return null;
  let pick: PickValue =
    overall >= CUTOFFS.amazing ? "amazing" : overall >= CUTOFFS.good ? "good" : overall >= CUTOFFS.maybe ? "maybe" : "no";
  const capped = !!flags?.short_exit || hasFailedMustHave(flags);
  if (capped && (pick === "amazing" || pick === "good")) pick = "maybe";
  return pick;
}

export const PICK_LABELS: Record<PickValue, string> = { amazing: "Amazing", good: "Good", maybe: "Maybe", no: "No" };

export type RequirementScoreLike = { score?: number | null; importance?: string | null } | null | undefined;
const REQ_WEIGHT: Record<string, number> = { must: 3, core: 2, nice: 1 };

/** JD fit 0–100 from requirement scores (importance-weighted, unscored excluded). Null when nothing scored. */
export function computeJdFit(reqs: Record<string, RequirementScoreLike> | null | undefined): number | null {
  if (!reqs) return null;
  let sum = 0;
  let wsum = 0;
  for (const r of Object.values(reqs)) {
    const s = validScore({ score: r?.score });
    if (s === null) continue;
    const w = REQ_WEIGHT[String(r?.importance ?? "core")] ?? 2;
    sum += s * w;
    wsum += w;
  }
  if (!wsum) return null;
  return Math.round(Math.min(100, Math.max(0, ((sum / wsum - 1) / 4) * 100)));
}

export type RequirementStatus = "met" | "partial" | "not_met" | "not_covered";

/** Anchor 3 = meets the bar. ≥3 met · ≥2 partial · below not met · null not covered. */
export function requirementStatus(score: number | null | undefined): RequirementStatus {
  if (typeof score !== "number" || !Number.isFinite(score)) return "not_covered";
  return score >= 3 ? "met" : score >= 2 ? "partial" : "not_met";
}
