/**
 * Runs the golden set through the real evaluation pipeline and computes agreement metrics.
 * Mocked (default): the gateway is replaced by makeMockFetch(case.truth).
 * Live (EVAL_LIVE=1): the real gateway; returns { skipped: reason } on 402 / no key.
 */
import { evaluateCall } from "../../lib/ai/evaluate";
import { computeOverall, pickFor, hasFailedMustHave, type PickValue } from "../../lib/ai/scoring-math";
import { AiError } from "../../lib/ai/client";
import type { ScoreCallResult } from "../../lib/ai/schemas";
import { GOLDEN, type GoldenCase } from "./golden";
import { makeMockFetch } from "./mock-gateway";

export type CaseResult = {
  id: string;
  expectedPick: PickValue | null;
  pick: PickValue | null;
  overall: number | null;
  callClass: string;
  expectedClass: string;
  criteria: Record<string, { value: number | null; range: [number, number]; abs: number | null; inRange: boolean }>;
  needsReview: boolean;
  confidence: number;
  mustFailed: boolean;
  problems: string[];
};

export type Metrics = {
  cases: number;
  pickMatchPct: number;
  classMatchPct: number;
  criteriaInRangePct: number;
  maeByCriterion: Record<string, number>;
  maeOverall: number;
  needsReviewRate: number;
};

function valueOf(r: ScoreCallResult, key: string): number | null {
  return r.requirement_scores?.[key]?.score ?? r.qualities[key]?.score ?? null;
}

export function judge(c: GoldenCase, r: ScoreCallResult): CaseResult {
  const scored = r.call_class === "conversation";
  const overall = scored ? computeOverall(r.qualities, c.job.weights) : null;
  const pick = scored ? pickFor(overall, { short_exit: r.short_exit, must_have_results: r.must_have_results }) : null;
  const problems: string[] = [];
  const criteria: CaseResult["criteria"] = {};
  for (const [key, range] of Object.entries(c.expect.criteria ?? {})) {
    const value = scored ? valueOf(r, key) : null;
    const mid = (range[0] + range[1]) / 2;
    const inRange = value !== null && value >= range[0] - 1e-9 && value <= range[1] + 1e-9;
    criteria[key] = { value, range, abs: value === null ? null : Math.abs(value - mid), inRange };
    if (!inRange) problems.push(`${key}=${value ?? "null"} not in [${range[0]}, ${range[1]}]`);
  }
  if (pick !== c.expect.pick) problems.push(`pick ${pick ?? "not scored"} ≠ expected ${c.expect.pick ?? "not scored"}`);
  if (r.call_class !== c.expect.call_class) problems.push(`class ${r.call_class} ≠ ${c.expect.call_class}`);
  const mustFailed = hasFailedMustHave({ must_have_results: r.must_have_results });
  if (c.expect.must_failed !== undefined && mustFailed !== c.expect.must_failed) problems.push(`must_failed ${mustFailed}`);
  if (c.expect.needs_review !== undefined && !!r.needs_review !== c.expect.needs_review) problems.push(`needs_review ${!!r.needs_review}`);
  if (c.expect.max_confidence !== undefined && (r.confidence ?? 0) > c.expect.max_confidence) problems.push(`confidence ${r.confidence} > ${c.expect.max_confidence}`);
  return {
    id: c.id,
    expectedPick: c.expect.pick,
    pick,
    overall,
    callClass: r.call_class ?? "conversation",
    expectedClass: c.expect.call_class,
    criteria,
    needsReview: !!r.needs_review,
    confidence: r.confidence ?? 0,
    mustFailed,
    problems,
  };
}

export function metricsOf(results: CaseResult[]): Metrics {
  const n = results.length || 1;
  const pct = (k: number) => Math.round((k / n) * 1000) / 10;
  const errs: Record<string, number[]> = {};
  let inRange = 0;
  let total = 0;
  for (const r of results) {
    for (const [k, v] of Object.entries(r.criteria)) {
      total++;
      if (v.inRange) inRange++;
      const family = k; // per criterion key
      (errs[family] ??= []).push(v.abs ?? 4);
    }
  }
  const maeByCriterion = Object.fromEntries(Object.entries(errs).map(([k, a]) => [k, Math.round((a.reduce((x, y) => x + y, 0) / a.length) * 100) / 100]));
  const all = Object.values(errs).flat();
  const scored = results.filter((r) => r.callClass === "conversation");
  return {
    cases: results.length,
    pickMatchPct: pct(results.filter((r) => r.pick === r.expectedPick).length),
    classMatchPct: pct(results.filter((r) => r.callClass === r.expectedClass).length),
    criteriaInRangePct: total ? Math.round((inRange / total) * 1000) / 10 : 100,
    maeByCriterion,
    maeOverall: all.length ? Math.round((all.reduce((x, y) => x + y, 0) / all.length) * 100) / 100 : 0,
    needsReviewRate: scored.length ? Math.round((scored.filter((r) => r.needsReview).length / scored.length) * 1000) / 10 : 0,
  };
}

function inputFor(c: GoldenCase) {
  return {
    transcript: c.transcript,
    role: c.job.title,
    mustHaves: c.job.mustHaves,
    niceToHaves: c.job.niceToHaves,
    cultureValues: c.job.cultureValues,
    openRoles: c.job.openRoles,
    resumeNote: c.resumeNote ?? null,
    candidateName: c.candidateName,
    callTime: "2026-11-15T09:00:00Z",
    roleProfile: c.job.profile,
  };
}

export async function runGolden(opts: { live: boolean; only?: string[] }): Promise<{ results: CaseResult[]; metrics: Metrics } | { skipped: string }> {
  const results: CaseResult[] = [];
  const cases = GOLDEN.filter((c) => !opts.only || opts.only.includes(c.id));
  const realFetch = globalThis.fetch;
  for (const c of cases) {
    try {
      if (!opts.live) globalThis.fetch = makeMockFetch(c.truth) as typeof fetch;
      const r = await evaluateCall(inputFor(c));
      results.push(judge(c, r));
    } catch (e) {
      if (opts.live && e instanceof AiError && (e.status === 402 || e.status === 401 || e.kind === "config")) {
        return { skipped: `AI gateway unavailable (${e.status ?? e.kind}); live validation pending` };
      }
      throw e;
    } finally {
      globalThis.fetch = realFetch;
    }
  }
  return { results, metrics: metricsOf(results) };
}

export function formatReport(results: CaseResult[], m: Metrics, mode: string): string {
  const lines = [
    `Pingo evaluation calibration (${mode}) — ${m.cases} golden calls`,
    `  exact pick match:        ${m.pickMatchPct}%`,
    `  call class match:        ${m.classMatchPct}%`,
    `  criteria within range:   ${m.criteriaInRangePct}%`,
    `  mean abs error (all):    ${m.maeOverall}`,
    `  needs_review rate:       ${m.needsReviewRate}% of scored calls`,
    `  mean abs error per criterion: ${Object.entries(m.maeByCriterion)
      .map(([k, v]) => `${k} ${v}`)
      .join(", ")}`,
    "",
    ...results.map(
      (r) =>
        `  ${r.problems.length ? "✗" : "✓"} ${r.id.padEnd(30)} pick ${String(r.pick ?? "-").padEnd(8)} (want ${String(r.expectedPick ?? "-").padEnd(8)}) overall ${String(r.overall ?? "-").padEnd(4)} conf ${r.confidence.toFixed(2)}${r.needsReview ? " needs-review" : ""}${r.problems.length ? `  ← ${r.problems.join("; ")}` : ""}`,
    ),
  ];
  return lines.join("\n");
}
