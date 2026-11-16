/** Pure parts of the eval-v1 pipeline: classification heuristics, plan coverage, maths, callback rule. */
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("../../lib/supabase/admin", () => ({ createAdminClient: () => null }));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => undefined }));

import { heuristicClass, outcomeForClass } from "../../lib/ai/classify-call";
import { buildInterviewPlan, compressPlan, requiredCoverage } from "../../lib/ai/interview-plan";
import { completeRoleProfile, fallbackRoleProfile, readRoleProfile } from "../../lib/ai/role-profile";
import { RoleProfileBodySchema } from "../../lib/ai/role-profile-schema";
import { combinePasses, confidenceOf, foldQuality } from "../../lib/ai/evaluate";
import { computeJdFit, requirementStatus } from "../../lib/ai/scoring-math";
import { interviewPlanFor } from "../../lib/ai/call-brief";
import { callbackAllowed } from "../../lib/calls/webhook";
import { SALES, SDE } from "../eval/profiles";

describe("heuristic call classification", () => {
  it("catches voicemail, operator messages, someone else and silence", () => {
    expect(heuristicClass("assistant: Hi\nuser: Please leave your message after the beep.").cls).toBe("voicemail");
    expect(heuristicClass("assistant: Hi\nuser: Aapne jis number par call kiya hai woh abhi vyast hai").cls).toBe("voicemail");
    expect(heuristicClass("assistant: Is this Ravi?\nuser: No, I am his brother, he is not here.").cls).toBe("wrong_person");
    expect(heuristicClass("assistant: Hello?\nuser: Hello?").cls).toBe("no_speech");
    expect(heuristicClass("").cls).toBe("no_speech");
  });

  it("never short-circuits a real conversation that mentions those words", () => {
    const long = Array.from({ length: 8 }, (_, i) => `assistant: Question ${i}?\nuser: In my last job I called business owners every day and the boss is not available on weekends, so I handled renewals myself and learned a lot.`).join("\n");
    const h = heuristicClass(long);
    expect(h.cls).toBe("conversation");
    expect(h.confident).toBe(true);
  });

  it("maps non-conversations to a retryable outcome", () => {
    expect(outcomeForClass("voicemail")).toEqual({ outcome: "voicemail", retry: true });
    expect(outcomeForClass("wrong_person").outcome).toBe("wrong_person");
    expect(outcomeForClass("no_speech")).toEqual({ outcome: "no_answer", retry: true });
    expect(outcomeForClass("conversation").retry).toBe(false);
  });
});

describe("role profile", () => {
  it("fallback turns must-haves into must requirements and checks, with anchors for every quality and trait", () => {
    const p = fallbackRoleProfile({ title: "Sales", mustHaves: ["Can join within 30 days", "2+ years B2B sales"], niceToHaves: ["CRM"], customTraits: [{ key: "grit", name: "Grit", description: "Keeps going" }] });
    expect(p.requirements.filter((r) => r.importance === "must")).toHaveLength(2);
    expect(p.requirements.find((r) => r.text.includes("join"))?.kind).toBe("logistics");
    expect(p.must_have_checks).toHaveLength(2);
    expect(Object.keys(p.quality_anchors)).toEqual(expect.arrayContaining(["skills", "storytelling", "grit"]));
    const { version: _v, source: _s, ...body } = p;
    void _v;
    void _s;
    expect(RoleProfileBodySchema.safeParse(body).success).toBe(true);
  });

  it("schema rejects missing anchors and duplicate ids", () => {
    const { version: _a, source: _b, ...p } = structuredClone(SALES.profile);
    void _a;
    void _b;
    delete (p.requirements[0].anchors as Record<string, string>)["5"];
    expect(RoleProfileBodySchema.safeParse(p).success).toBe(false);
    const { version: _c, source: _d, ...q } = structuredClone(SALES.profile);
    void _c;
    void _d;
    q.requirements[1].id = q.requirements[0].id;
    expect(RoleProfileBodySchema.safeParse(q).success).toBe(false);
  });

  it("reads a stored row and completes it against the current traits", () => {
    const row = { version: 4, source: "generated", requirements: SALES.profile.requirements, must_have_checks: SALES.profile.must_have_checks, quality_anchors: { skills: SALES.profile.quality_anchors.skills } };
    const p = readRoleProfile(row)!;
    expect(p.version).toBe(4);
    const done = completeRoleProfile(p, [{ key: "grit", name: "Grit" }]);
    expect(Object.keys(done.quality_anchors)).toEqual(expect.arrayContaining(["experience", "grit"]));
    expect(readRoleProfile({ requirements: "nope", must_have_checks: [], quality_anchors: {} })).toBeNull();
  });
});

describe("interview plan", () => {
  for (const job of [SALES, SDE]) {
    it(`${job.title}: covers every must-have, must/core requirement, weighted quality and custom trait`, () => {
      const profile = completeRoleProfile(job.profile, [{ key: "grit", name: "Grit", description: "Keeps going after a no" }]);
      const input = { profile, weights: job.weights, traitKeys: ["grit"], candidate: { skills: ["HubSpot", "Postgres"], current_role: "Sales" } };
      const items = buildInterviewPlan(input);
      const covered = new Set(items.flatMap((i) => i.covers));
      for (const id of requiredCoverage(input)) expect(covered.has(id), id).toBe(true);
      expect(items[0].tag).toBe("must"); // must-haves come first
      const text = compressPlan(items);
      expect(text.length).toBeLessThanOrEqual(2200);
      expect(text).toMatch(/\[MUST\]/);
      expect(text).toMatch(/\[TRAIT\]/);
    });
  }

  it("compression drops nice-to-haves before anything else", () => {
    const items = buildInterviewPlan({ profile: SALES.profile, weights: SALES.weights });
    const tight = compressPlan(items, 900);
    expect(tight).not.toMatch(/IF TIME/);
    expect((tight.match(/\[(MUST|CORE)\]/g) ?? []).length).toBe(items.filter((i) => i.tag === "must" || i.tag === "core").length);
  });

  it("brief builds a plan from the rubric when no role profile exists (traits and must-haves included)", () => {
    const plan = interviewPlanFor({ skills: [] }, { must_haves: [{ text: "Can join within 30 days" }], custom_traits: [{ key: "grit", name: "Grit", description: "Keeps going" }] }, "Sales", {});
    expect(plan).toMatch(/\[MUST\]/);
    expect(plan).toMatch(/Grit|grit/);
  });
});

describe("scoring maths", () => {
  it("two passes: mean within 1 point, needs review beyond", () => {
    expect(combinePasses(4, 3)).toEqual({ score: 3.5, disagree: false, diff: 1 });
    expect(combinePasses(4, 2)).toMatchObject({ score: 3, disagree: true });
    expect(combinePasses(null, null).score).toBeNull();
    expect(combinePasses(3, null)).toMatchObject({ score: 3, disagree: true });
  });

  it("quality folds in mapped requirements by importance; nothing scored stays null", () => {
    expect(foldQuality(4, [{ score: 5, importance: "must" }, { score: 3, importance: "core" }])).toBeCloseTo((8 + 15 + 6) / 7, 1);
    expect(foldQuality(null, [{ score: null, importance: "must" }])).toBeNull();
    expect(foldQuality(null, [{ score: 4, importance: "nice" }])).toBe(4);
  });

  it("JD fit is importance-weighted over scored requirements only (not covered never penalised)", () => {
    expect(computeJdFit({ a: { score: 5, importance: "must" }, b: { score: null, importance: "core" } })).toBe(100);
    expect(computeJdFit({ a: { score: 5, importance: "must" }, b: { score: 1, importance: "nice" } })).toBe(75);
    expect(computeJdFit({})).toBeNull();
    expect(requirementStatus(3)).toBe("met");
    expect(requirementStatus(2.5)).toBe("partial");
    expect(requirementStatus(1.5)).toBe("not_met");
    expect(requirementStatus(null)).toBe("not_covered");
  });

  it("confidence grows with coverage and agreement", () => {
    const all = Object.fromEntries([...SALES.profile.requirements.map((r) => r.id), ...Object.keys(SALES.profile.quality_anchors)].map((k) => [k, "asked_answered" as const]));
    expect(confidenceOf(SALES.profile, all, { agreement_rate: 1 })).toBe(1);
    expect(confidenceOf(SALES.profile, all, { agreement_rate: 0.5 })).toBe(0.8);
    expect(confidenceOf(SALES.profile, {}, { agreement_rate: 1 })).toBe(0);
  });
});

describe("callback booking after a call (review #9)", () => {
  const base = { short_exit: false, conduct_ended: false };
  it("books only from short or cut-off calls", () => {
    expect(callbackAllowed(base, { outcome: "completed", duration_s: 90 })).toBe(true);
    expect(callbackAllowed(base, { outcome: "dropped", duration_s: 500 })).toBe(true);
    expect(callbackAllowed(base, { outcome: "completed", duration_s: 520 })).toBe(false);
  });
  it("never after a full call, a planned short exit or a conduct end", () => {
    expect(callbackAllowed({ ...base, short_exit: true }, { outcome: "short_exit", duration_s: 100 })).toBe(false);
    expect(callbackAllowed({ ...base, conduct_ended: true }, { outcome: "completed", duration_s: 60 })).toBe(false);
  });
  it("a long call that never reached most must/core requirements counts as cut off", () => {
    const reqs = { a: { importance: "must" }, b: { importance: "core" }, c: { importance: "core" } };
    expect(callbackAllowed({ ...base, requirement_scores: reqs, coverage: { a: "asked_answered", b: "not_asked", c: "not_asked" } }, { outcome: "completed", duration_s: 400 })).toBe(true);
    expect(callbackAllowed({ ...base, requirement_scores: reqs, coverage: { a: "asked_answered", b: "asked_weak", c: "not_asked" } }, { outcome: "completed", duration_s: 400 })).toBe(false);
  });
});
