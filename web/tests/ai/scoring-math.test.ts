import { describe, expect, it } from "vitest";
import { computeOverall, pickFor, hasFailedMustHave } from "../../lib/ai/scoring-math";

const q = (o: Record<string, number | null>) => Object.fromEntries(Object.entries(o).map(([k, s]) => [k, { score: s }]));

describe("computeOverall", () => {
  it("maps a weighted 1–5 mean onto 0–100", () => {
    expect(computeOverall(q({ skills: 5, experience: 5 }), { skills: 50, experience: 50 })).toBe(100);
    expect(computeOverall(q({ skills: 1, experience: 1 }), { skills: 50, experience: 50 })).toBe(0);
    expect(computeOverall(q({ skills: 3 }), { skills: 100 })).toBe(50);
    // (4*30 + 2*10) / 40 = 3.5 → 62.5 → 63
    expect(computeOverall(q({ skills: 4, experience: 2 }), { skills: 30, experience: 10 })).toBe(63);
  });

  it("renormalises weights over scored qualities only", () => {
    // experience null → only skills counts, regardless of its weight share
    expect(computeOverall(q({ skills: 5, experience: null }), { skills: 30, experience: 70 })).toBe(100);
    // unweighted qualities are ignored
    expect(computeOverall(q({ skills: 5, curiosity: 1 }), { skills: 30 })).toBe(100);
  });

  it("returns null when nothing weighted is scored, and ignores bad weights/scores", () => {
    expect(computeOverall(q({ skills: null }), { skills: 100 })).toBeNull();
    expect(computeOverall({}, { skills: 100 })).toBeNull();
    expect(computeOverall(q({ skills: 5 }), {})).toBeNull();
    expect(computeOverall(q({ skills: 5, experience: 1 }), { skills: 50, experience: -10 })).toBe(100);
    expect(computeOverall(q({ skills: 9, experience: 3 }), { skills: 50, experience: 50 })).toBe(50);
    expect(computeOverall(null, { skills: 1 })).toBeNull();
  });
});

describe("pickFor", () => {
  it("applies cut-offs at the boundaries", () => {
    expect(pickFor(80)).toBe("amazing");
    expect(pickFor(79.9)).toBe("good");
    expect(pickFor(65)).toBe("good");
    expect(pickFor(64)).toBe("maybe");
    expect(pickFor(45)).toBe("maybe");
    expect(pickFor(44)).toBe("no");
    expect(pickFor(0)).toBe("no");
    expect(pickFor(null)).toBeNull();
    expect(pickFor(NaN)).toBeNull();
  });

  it("caps at Maybe on a failed must-have or short exit, never raises", () => {
    expect(pickFor(95, { short_exit: true })).toBe("maybe");
    expect(pickFor(70, { must_have_results: [{ met: true }, { met: false }] })).toBe("maybe");
    expect(pickFor(90, { must_have_failed: true })).toBe("maybe");
    expect(pickFor(30, { short_exit: true })).toBe("no");
    expect(pickFor(90, { must_have_results: [{ met: "unknown" }, { met: null }] })).toBe("amazing");
  });

  it("hasFailedMustHave", () => {
    expect(hasFailedMustHave(null)).toBe(false);
    expect(hasFailedMustHave({ must_have_results: [{ met: false }] })).toBe(true);
  });
});
