/** scoreCall / client behaviour with a mocked gateway (no network). */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { scoreCall } from "../../lib/ai/score-call";
import { extractJson } from "../../lib/ai/client";
import { ScoreCallResultSchema } from "../../lib/ai/schemas";
import { WEAK_TRANSCRIPT } from "./fixtures";
import { makeMockFetch, type GatewayLog, type Truth } from "../eval/mock-gateway";

function reply(obj: unknown, status = 200) {
  return new Response(
    JSON.stringify({ model: "claude-test", choices: [{ message: { content: "Here you go:\n```json\n" + JSON.stringify(obj) + "\n```" } }] }),
    { status, headers: { "content-type": "application/json" } },
  );
}

const input = {
  transcript: WEAK_TRANSCRIPT,
  role: "Sales Executive",
  mustHaves: [{ text: "2+ years B2B sales" }],
  openRoles: [{ id: "job-2", title: "Office Assistant" }],
  customTraits: [{ key: "ownership", name: "Ownership", description: "takes responsibility" }],
  candidateName: "Rohan Mehta",
  callTime: "2026-11-15T09:00:00Z",
};

describe("scoreCall (mocked gateway, multi-pass)", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("AI_API_KEY", "test-key");
    vi.stubEnv("AI_BASE_URL", "https://gateway.test/v1");
  });
  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  const truth: Truth = {
    classify: { callback_requested_at: "2026-11-16T16:00:00" },
    evidence: {
      skills: { q: ["I sold a million dollars of software"], s: 5 }, // invented → dropped
      experience: { q: ["I have not done any sales job yet"], s: 1 },
      ownership: { q: ["No, never."], s: 3 },
    },
    must: { mh_2_years_b2b_sales: { status: "not_met", quote: "No, never." } },
    flags: { other_role: { title: "Office Assistant", reason: "" } },
  };

  it("validates, verifies quotes, maps roles, anonymises, and resolves callback", async () => {
    const log: GatewayLog = [];
    fetchMock.mockImplementation(makeMockFetch(truth, log));
    const out = await scoreCall(input);
    expect(ScoreCallResultSchema.safeParse(out).success).toBe(true);
    expect(out.call_class).toBe("conversation");
    expect(out.qualities.skills.score).toBeNull(); // invented quote dropped → not covered
    expect(out.coverage?.skills).toBe("asked_weak");
    expect(out.qualities.experience.score).toBe(1);
    expect(out.qualities.ownership.score).toBe(3); // custom trait
    expect(out.flags.other_role).toEqual({ job_id: "job-2", title: "Office Assistant", reason: "" });
    expect(out.must_have_results[0]).toMatchObject({ met: false, status: "not_met" });
    expect(out.callback_requested_at).toBe("2026-11-16T16:00:00+05:30");
    expect(out.prompt_version).toMatch(/^eval-v/);
    expect(out.model_version).toBe("mock-evaluator");
    expect(log.map((l) => l.pass)).toEqual(["classify", "evidence", "score-1", "score-2", "summary"]);
    for (const call of fetchMock.mock.calls) {
      const body = JSON.parse(call[1].body);
      expect(JSON.stringify(body.messages)).not.toMatch(/Rohan|Mehta/);
      expect(body.temperature).toBeLessThanOrEqual(0.2);
      expect(call[0]).toBe("https://gateway.test/v1/chat/completions");
      expect(call[1].headers.Authorization).toBe("Bearer test-key");
    }
    // second pass is independent: different temperature and reversed order
    const s1 = log.find((l) => l.pass === "score-1")!;
    const s2 = log.find((l) => l.pass === "score-2")!;
    expect(s1.temperature).toBe(0);
    expect(s2.temperature).toBe(0.2);
    const order = (u: string) => [...u.matchAll(/^- ([a-z_0-9]+): .*\[asked/gm)].map((m) => m[1]);
    expect(order(s2.user)).toEqual([...order(s1.user)].reverse());
  });

  it("retries without temperature on 400", async () => {
    const mock = makeMockFetch(truth);
    fetchMock.mockResolvedValueOnce(new Response("bad", { status: 400 })).mockImplementation(mock);
    await scoreCall(input);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).temperature).toBeDefined();
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).temperature).toBeUndefined();
  });

  it("retries once when the evidence reply misses ids, then succeeds", async () => {
    const mock = makeMockFetch(truth);
    let first = true;
    fetchMock.mockImplementation(async (url: string, init: RequestInit) => {
      const sys = JSON.parse(String(init.body)).messages[0].content as string;
      if (first && sys.startsWith("PASS: evidence")) {
        first = false;
        return reply({ evidence: {}, must_haves: {} });
      }
      return mock(url, init);
    });
    const out = await scoreCall(input);
    expect(out.qualities.experience.score).toBe(1);
    expect(fetchMock.mock.calls.length).toBe(6); // 5 passes + 1 corrective retry
  });

  it("throws after a second schema failure", async () => {
    fetchMock.mockImplementation(async () => reply({ nope: true }));
    await expect(scoreCall(input)).rejects.toThrow(/schema/);
  });

  it("conduct_ended forces short_exit and the summary prefix", async () => {
    fetchMock.mockImplementation(makeMockFetch({ ...truth, classify: { conduct_ended: true }, summary: { summary: "Abusive language after two warnings." } }));
    const out = await scoreCall(input);
    expect(out.short_exit).toBe(true);
    expect(out.summary.startsWith("Call ended for conduct:")).toBe(true);
  });

  it("voicemail is caught without a model call and nothing is scored", async () => {
    const out = await scoreCall({ ...input, transcript: "assistant: Hi, am I speaking with Rohan?\nuser: Please leave your message after the tone." });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(out.call_class).toBe("voicemail");
    expect(Object.values(out.qualities).every((q) => q.score === null)).toBe(true);
  });

  it("the model can mark a short call as wrong person", async () => {
    fetchMock.mockImplementation(makeMockFetch({ classify: { call_class: "wrong_person", reason: "Colleague answered" }, evidence: {} }));
    const out = await scoreCall({ ...input, transcript: "assistant: Hi, is this Rohan?\nuser: Rohan? Hmm, I think you need the other desk, okay." });
    expect(out.call_class).toBe("wrong_person");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("extractJson", () => {
  it("handles fences, prose and braces inside strings", () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('Sure! {"a":"x}y","b":{"c":2}} hope that helps')).toEqual({ a: "x}y", b: { c: 2 } });
    expect(() => extractJson("no json here")).toThrow();
  });
});
