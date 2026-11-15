import { describe, expect, it } from "vitest";
import { verifyQuotes } from "../../lib/ai/verify-quotes";
import { anonymise } from "../../lib/ai/anonymise";
import { candidateText, normaliseText } from "../../lib/ai/text";
import { STRONG_HINGLISH, WEAK_TRANSCRIPT } from "./fixtures";

const quality = (score: number | null, quotes: string[]) => ({ score, reason: "r", quotes });

describe("verifyQuotes", () => {
  it("drops an invented quote and nulls a quality left with no evidence", () => {
    const out = verifyQuotes(
      {
        qualities: {
          experience: quality(2, ["I have not done any sales job yet", "I closed ten enterprise deals last year"]),
          skills: quality(5, ["I am the best salesperson in India"]),
        },
      },
      WEAK_TRANSCRIPT,
    );
    expect(out.qualities.experience.quotes.map((x) => x.text)).toEqual(["I have not done any sales job yet"]);
    expect(out.qualities.experience.score).toBe(2);
    expect(out.qualities.skills.quotes).toEqual([]);
    expect(out.qualities.skills.score).toBeNull();
  });

  it("ignores case, whitespace and punctuation differences", () => {
    const out = verifyQuotes(
      { qualities: { experience: quality(2, ["  i JUST finished   college, last month!! "]) } },
      WEAK_TRANSCRIPT,
    );
    expect(out.qualities.experience.score).toBe(2);
  });

  it("keeps Hinglish and Devanagari quotes (incl. NFC/NFD and danda differences)", () => {
    const deva = "मैंने पिछले क्वार्टर में 120% टारगेट पूरा किया।";
    const out = verifyQuotes(
      {
        qualities: {
          experience: quality(4, ["Main pichhle teen saal se B2B SaaS sales kar rahi hoon"]),
          skills: quality(4, [deva.normalize("NFD").replace("।", "")]),
          confidence: quality(3, ["मैंने पिछले साल 500% टारगेट"]), // invented Devanagari
        },
      },
      STRONG_HINGLISH,
    );
    expect(out.qualities.experience.score).toBe(4);
    expect(out.qualities.skills.score).toBe(4);
    expect(out.qualities.confidence.score).toBeNull();
  });

  it("only accepts the candidate's words, not the interviewer's", () => {
    const out = verifyQuotes(
      { qualities: { skills: quality(4, ["The role needs two or more years of B2B sales experience"]) } },
      WEAK_TRANSCRIPT,
    );
    expect(out.qualities.skills.score).toBeNull();
  });

  it("does not match partial words or tiny fragments", () => {
    const out = verifyQuotes({ qualities: { skills: quality(3, ["ust finished coll", "ok"]) } }, WEAK_TRANSCRIPT);
    expect(out.qualities.skills.score).toBeNull();
  });

  it("downgrades must-haves with invented quotes to unknown and filters mismatch claims", () => {
    const out = verifyQuotes(
      {
        qualities: {},
        must_have_results: [
          { text: "2+ years B2B sales", met: false, quote: "No, never." },
          { text: "English", met: true, quote: "I speak fluent English always" },
        ],
        flags: { resume_mismatch: [{ claim_quote: "I have not done any sales job yet", resume_line: "2 yrs sales" }, { claim_quote: "made up", resume_line: "x" }] },
      },
      WEAK_TRANSCRIPT,
    );
    expect(out.must_have_results?.[0]).toMatchObject({ met: false, quote: "No, never." });
    expect(out.must_have_results?.[1]).toMatchObject({ met: "unknown", quote: null });
    expect(out.flags?.resume_mismatch).toHaveLength(1);
  });
});

describe("text helpers", () => {
  it("normaliseText keeps Devanagari marks and strips punctuation", () => {
    expect(normaliseText("“Hello,  World!”")).toBe("hello world");
    expect(normaliseText("किया।")).toBe("किया");
  });
  it("candidateText falls back to full text without speaker labels", () => {
    expect(candidateText("just some words")).toBe("just some words");
    expect(candidateText("assistant: hi\nuser: hello there")).toBe("hello there");
  });
});

describe("anonymise", () => {
  it("replaces full name and tokens, Unicode-aware, without touching substrings", () => {
    const out = anonymise(WEAK_TRANSCRIPT, "Rohan Mehta");
    expect(out).not.toMatch(/rohan|mehta/i);
    expect(out).toContain("am I speaking with Candidate?");
    expect(anonymise("Rohani said hi to Rohan", "Rohan")).toBe("Rohani said hi to Candidate");
    expect(anonymise("मैं प्रिया हूँ", "प्रिया")).toBe("मैं Candidate हूँ");
    expect(anonymise("text", null)).toBe("text");
  });
});
