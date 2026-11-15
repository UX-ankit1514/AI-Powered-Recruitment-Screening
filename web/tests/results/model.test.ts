import { describe, expect, it } from "vitest";
import { evaluate, latestOverrides, rerank, rowsToCsv, sortRows, type RankRow } from "../../components/results/model";

const score = (s: Record<string, number>, extra: Partial<{ short_exit: boolean; met: boolean }> = {}) => ({
  qualities: Object.fromEntries(Object.entries(s).map(([k, v]) => [k, { score: v, quotes: [{ text: "q", ts: 3 }], reason: "r" }])),
  must_have_results: extra.met === false ? [{ text: "English", met: false }] : [],
  flags: { culture_standout: true, resume_mismatch: [{ claim_quote: "4 years", resume_line: "8 months" }] },
  summary: "S.",
  short_exit: extra.short_exit ?? false,
});

describe("results model", () => {
  it("computes overall and pick from weights, capped at Maybe on a failed must-have", () => {
    const e = evaluate(score({ skills: 5, experience: 5 }, { met: false }), { skills: 50, experience: 50 }, null);
    expect(e.overall).toBe(100);
    expect(e.scored_pick).toBe("maybe");
    expect(e.held).toBe("must-have not met");
    expect(e.mismatches).toEqual([{ claim_quote: "4 years", resume_line: "8 months" }]);
  });

  it("uses the latest override, and a null override clears it", () => {
    const m = latestOverrides([
      { candidate_id: "a", new_value: { pick: "no" }, note: null, at: "2026-01-02" },
      { candidate_id: "a", new_value: { pick: "good" }, note: "x", at: "2026-01-03" },
      { candidate_id: "b", new_value: { pick: "good" }, note: null, at: "2026-01-01" },
      { candidate_id: "b", new_value: { pick: null }, note: null, at: "2026-01-04" },
    ]);
    expect(m.get("a")?.pick).toBe("good");
    expect(m.has("b")).toBe(false);
    const e = evaluate(score({ skills: 1 }), { skills: 100 }, m.get("a")!);
    expect(e.scored_pick).toBe("no");
    expect(e.pick).toBe("good");
  });

  it("re-ranks instantly on other weights and keeps overrides", () => {
    const mk = (name: string, s: Record<string, number>): RankRow => ({
      candidate: { id: name, name, source: "csv", status: "scored", job_id: "j" },
      status: "scored",
      resume_only_score: null,
      call: null,
      ...evaluate(score(s), { skills: 100 }, null),
    });
    const rows = sortRows([mk("A", { skills: 5, learning_drive: 1 }), mk("B", { skills: 2, learning_drive: 5 })]);
    expect(rows[0].candidate.name).toBe("A");
    const flipped = rerank(rows, { learning_drive: 100 });
    expect(flipped[0].candidate.name).toBe("B");
  });

  it("guards CSV cells against formula injection", () => {
    const row: RankRow = {
      candidate: { id: "1", name: "=HYPERLINK(\"x\")", source: "csv", status: "scored", job_id: "j" },
      status: "scored",
      resume_only_score: 30,
      call: null,
      ...evaluate(score({ skills: 4 }), { skills: 100 }, null),
    };
    const csv = rowsToCsv([row], [{ key: "skills", name: "Skills" }]);
    expect(csv.split("\r\n")[1]).toContain(`"'=HYPERLINK(""x"")"`);
  });
});
