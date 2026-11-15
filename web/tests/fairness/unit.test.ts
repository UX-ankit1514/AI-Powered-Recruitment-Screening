import { describe, expect, it } from "vitest";
import { callQualityBucket, languageMix, regionBucket, sourceBucket, CALL_QUALITY } from "../../lib/fairness/groups";
import { FLAG_GAP, MIN_GROUP_N, statusFor, summarizeBias, type BiasInputRow } from "../../lib/fairness/summary";

describe("languageMix", () => {
  it("reads plain English", () => {
    expect(languageMix("assistant: Tell me about you\nuser: I worked in sales for three years and closed many enterprise deals last quarter")).toBe(
      "english",
    );
  });
  it("reads romanised Hinglish", () => {
    expect(languageMix("user: Haan mujhe sales mein teen saal ka experience hai aur maine bahut deals close kiye hain")).toBe("hinglish");
  });
  it("reads Devanagari mixed with English as Hinglish", () => {
    expect(languageMix("user: मेरा sales में तीन साल का experience है and I handled enterprise clients directly")).toBe("hinglish");
  });
  it("reads pure Hindi and other Indian scripts as other", () => {
    expect(languageMix("user: मेरा नाम राहुल है और मैं बिक्री में तीन साल से काम कर रहा हूँ")).toBe("other");
    expect(languageMix("user: ನಾನು ಮೂರು ವರ್ಷಗಳಿಂದ ಮಾರಾಟದಲ್ಲಿ ಕೆಲಸ ಮಾಡುತ್ತಿದ್ದೇನೆ ಮತ್ತು ಗ್ರಾಹಕರೊಂದಿಗೆ ಮಾತನಾಡುತ್ತೇನೆ")).toBe("other");
  });
  it("only counts the candidate's words, not the interviewer's", () => {
    const t = "assistant: Aap kaise hain? Kya aap sales mein kaam karte hain? Accha theek hai\nuser: Yes I have three years of experience in B2B software sales";
    expect(languageMix(t)).toBe("english");
  });
  it("returns null with too little speech", () => {
    expect(languageMix("user: yes okay")).toBeNull();
    expect(languageMix("")).toBeNull();
    expect(languageMix(null)).toBeNull();
  });
});

describe("regionBucket", () => {
  it("maps metros and their satellite cities", () => {
    expect(regionBucket("Gurugram, Haryana")).toBe("Delhi NCR");
    expect(regionBucket("Navi Mumbai")).toBe("Mumbai");
    expect(regionBucket("bangalore")).toBe("Bengaluru");
    expect(regionBucket("Secunderabad")).toBe("Hyderabad");
  });
  it("falls back to the state", () => {
    expect(regionBucket("Lucknow")).toBe("Uttar Pradesh");
    expect(regionBucket("Indore, MP")).toBe("Madhya Pradesh");
    expect(regionBucket("Kerala")).toBe("Kerala");
  });
  it("handles unknown and abroad", () => {
    expect(regionBucket(null)).toBe("Not given");
    expect(regionBucket("  ")).toBe("Not given");
    expect(regionBucket("Dubai, UAE")).toBe("Outside India");
    expect(regionBucket("Somewhere small")).toBe("Other places");
  });
});

describe("sourceBucket", () => {
  it("groups the ways people reach us", () => {
    expect(sourceBucket("form")).toBe("Apply form");
    expect(sourceBucket("csv")).toBe("Spreadsheet");
    expect(sourceBucket("employer_upload")).toBe("Spreadsheet");
    expect(sourceBucket("portal_mock")).toBe("Job portal");
    expect(sourceBucket("naukri")).toBe("Job portal");
    expect(sourceBucket("referral")).toBe("Other");
    expect(sourceBucket(null)).toBe("Other");
  });
});

describe("callQualityBucket", () => {
  it("separates dropped, cut-short and normal calls", () => {
    expect(callQualityBucket({ outcome: "dropped", duration_s: 400 })).toBe(CALL_QUALITY.dropped);
    expect(callQualityBucket({ outcome: "completed", duration_s: 400, hr_review: "Audio was choppy" })).toBe(CALL_QUALITY.dropped);
    expect(callQualityBucket({ outcome: "completed", duration_s: 90 })).toBe(CALL_QUALITY.short);
    expect(callQualityBucket({ outcome: "completed", duration_s: 400 })).toBe(CALL_QUALITY.normal);
  });
  it("does not treat a planned short exit as a call-quality problem", () => {
    expect(callQualityBucket({ outcome: "short_exit", duration_s: 90, short_exit: true })).toBe(CALL_QUALITY.normal);
  });
});

describe("statusFor (flag rule)", () => {
  it(`flags a group of ${MIN_GROUP_N}+ that is ${FLAG_GAP}+ points below average`, () => {
    expect(statusFor(8, -10)).toBe("flag");
    expect(statusFor(20, -15.5)).toBe("flag");
  });
  it("does not flag a big group that is less than 10 below", () => {
    expect(statusFor(8, -9.9)).toBe("ok");
    expect(statusFor(30, 4)).toBe("ok");
  });
  it("marks small low groups as watch, tiny groups as too few", () => {
    expect(statusFor(7, -20)).toBe("watch");
    expect(statusFor(3, -12)).toBe("watch");
    expect(statusFor(2, -30)).toBe("too_few");
    expect(statusFor(5, 2)).toBe("ok");
  });
});

// ---------------------------------------------------------------------------
const W = { skills: 50, experience: 50 };
const q = (s: number) => ({ skills: { score: s }, experience: { score: s } });
let i = 0;
function row(score: number, over: Partial<BiasInputRow> = {}): BiasInputRow {
  return {
    candidate_id: `c${i++}`,
    source: "csv",
    location: "Bengaluru",
    qualities: q(score),
    must_have_results: [],
    short_exit: false,
    language_mix: "english",
    hr_review: null,
    outcome: "completed",
    duration_s: 420,
    ...over,
  };
}
const JOB = { id: "j1", title: "Sales" };

describe("summarizeBias", () => {
  it("computes overall with the current weights and flags a consistently lower group", () => {
    // 8 English at 5/5 (=100), 8 Hinglish at 3/5 (=50): job mean 75, Hinglish 25 below.
    const rows = [...Array.from({ length: 8 }, () => row(5)), ...Array.from({ length: 8 }, () => row(3, { language_mix: "hinglish" }))];
    const s = summarizeBias(JOB, rows, W);
    expect(s.overall.n).toBe(16);
    expect(s.overall.mean).toBe(75);
    const lang = s.dimensions.find((d) => d.key === "language")!;
    const hing = lang.groups.find((g) => g.label === "Hinglish")!;
    expect(hing).toMatchObject({ n: 8, mean: 50, gap: -25, status: "flag", shareGood: 0 });
    expect(lang.groups.find((g) => g.label === "English")).toMatchObject({ n: 8, mean: 100, gap: 25, status: "ok", shareGood: 1 });
    expect(s.alerts).toEqual([{ dimension: "language", dimensionLabel: "Language on the call", group: "Hinglish", n: 8, mean: 50, gap: -25 }]);
    // every other dimension is a single group equal to the job: no flags
    for (const d of s.dimensions.filter((x) => x.key !== "language")) expect(d.groups.every((g) => g.status !== "flag")).toBe(true);
  });

  it("does not flag the same gap when the group has fewer than 8 people", () => {
    const rows = [...Array.from({ length: 10 }, () => row(5)), ...Array.from({ length: 7 }, () => row(3, { location: "Patna" }))];
    const s = summarizeBias(JOB, rows, W);
    const bihar = s.dimensions.find((d) => d.key === "region")!.groups.find((g) => g.label === "Bihar")!;
    expect(bihar.status).toBe("watch");
    expect(s.alerts).toHaveLength(0);
  });

  it("counts short exits, caps picks, and derives language from the transcript when not stored", () => {
    const rows = [
      row(5, { short_exit: true }), // 100 but capped at Maybe
      row(5),
      row(4, { language_mix: null, transcript_for_mix: "user: Haan mujhe sales mein teen saal ka experience hai aur maine deals close kiye" }),
    ];
    const s = summarizeBias(JOB, rows, W);
    expect(s.overall.shortExitRate).toBeCloseTo(1 / 3);
    expect(s.overall.shareGood).toBeCloseTo(2 / 3);
    const lang = s.dimensions.find((d) => d.key === "language")!;
    expect(lang.groups.map((g) => g.label)).toContain("Hinglish");
  });

  it("leaves out rows with nothing weighted to judge on, and handles an empty job", () => {
    const s = summarizeBias(JOB, [row(5), row(4, { qualities: { skills: { score: null } } })], W);
    expect(s.overall.n).toBe(1);
    expect(s.unscored).toBe(1);
    const empty = summarizeBias(JOB, [], W);
    expect(empty.overall).toMatchObject({ n: 0, mean: null });
    expect(empty.alerts).toEqual([]);
  });

  it("re-weights: the same rows give a different overall when weights change", () => {
    const r = row(0, { qualities: { skills: { score: 5 }, experience: { score: 1 } } });
    expect(summarizeBias(JOB, [r], { skills: 100, experience: 0 }).overall.mean).toBe(100);
    expect(summarizeBias(JOB, [r], { skills: 50, experience: 50 }).overall.mean).toBe(50);
  });

  it("never produces protected-attribute groups", () => {
    const s = summarizeBias(JOB, [row(4)], W);
    expect(s.dimensions.map((d) => d.key)).toEqual(["language", "region", "source", "call_quality"]);
  });
});
