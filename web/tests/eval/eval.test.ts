/**
 * Calibration harness. `npm run eval` (mocked, runs in CI) or `EVAL_LIVE=1 npm run eval` (real
 * gateway; skips cleanly when the gateway answers 402 / has no key).
 */
import { existsSync, readFileSync } from "node:fs";
import { parse } from "dotenv";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { formatReport, runGolden } from "./run-eval";
import { GOLDEN } from "./golden";

const LIVE = process.env.EVAL_LIVE === "1";
if (LIVE && !process.env.AI_API_KEY) {
  const file = process.env.AI_ENV_FILE ?? "/Users/shubhgoel/Desktop/shubhpersonal/highrefine/.env.local";
  if (existsSync(file)) {
    const env = parse(readFileSync(file));
    if (env.AI_API_KEY) process.env.AI_API_KEY = env.AI_API_KEY;
    if (env.AI_BASE_URL) process.env.AI_BASE_URL = env.AI_BASE_URL;
  }
}

describe(`evaluation calibration (${LIVE ? "live" : "mocked"})`, () => {
  it("golden set covers both roles and every required scenario", () => {
    expect(GOLDEN.length).toBeGreaterThanOrEqual(12);
    expect(new Set(GOLDEN.map((c) => c.job.title)).size).toBe(2);
    for (const id of ["weak_resume", "rambling", "hinglish", "gaming", "wrong_person", "voicemail", "partial", "must_fail"]) {
      expect(GOLDEN.some((c) => c.id.includes(id)), id).toBe(true);
    }
  });

  it("runs the pipeline on every golden call and meets the agreement bar", { timeout: LIVE ? 1_800_000 : 60_000 }, async (ctx) => {
    if (!LIVE) {
      vi.stubEnv("AI_API_KEY", "mock-key");
      vi.stubEnv("AI_BASE_URL", "https://gateway.mock/v1");
    }
    const out = await runGolden({ live: LIVE });
    vi.unstubAllEnvs();
    if ("skipped" in out) {
      console.info(`[eval] skipped: ${out.skipped}`);
      ctx.skip();
      return;
    }
    console.info(formatReport(out.results, out.metrics, LIVE ? "live" : "mocked"));
    if (LIVE) {
      // Live bar: the model must agree with the human calibration most of the time.
      expect(out.metrics.classMatchPct).toBeGreaterThanOrEqual(90);
      expect(out.metrics.pickMatchPct).toBeGreaterThanOrEqual(75);
      expect(out.metrics.maeOverall).toBeLessThanOrEqual(0.75);
    } else {
      // Mocked: the plumbing must reproduce the calibration exactly.
      expect(out.results.filter((r) => r.problems.length).map((r) => `${r.id}: ${r.problems.join("; ")}`)).toEqual([]);
      expect(out.metrics.pickMatchPct).toBe(100);
    }
  });
});
