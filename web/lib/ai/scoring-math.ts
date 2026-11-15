/**
 * Pure scoring maths shared by server and client (no server imports, no I/O).
 * Overall = weighted mean of the SCORED qualities (weights renormalised over qualities with a score),
 * mapped from 1–5 to 0–100 as (avg − 1) / 4 × 100. Pick cut-offs: Amazing ≥80, Good ≥65, Maybe ≥45, else No.
 * A failed must-have or a short exit caps the pick at Maybe.
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
