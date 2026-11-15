/** scoreCall / client behaviour with a mocked gateway (no network). */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { scoreCall } from "../../lib/ai/score-call";
import { extractJson } from "../../lib/ai/client";
import { ScoreCallResultSchema } from "../../lib/ai/schemas";
import { WEAK_TRANSCRIPT } from "./fixtures";

const KEYS = ["skills", "experience", "confidence", "culture_fit", "curiosity", "learning_drive", "storytelling"];

function reply(obj: unknown, status = 200) {
  return new Response(
    JSON.stringify({ model: "claude-test", choices: [{ message: { content: "Here you go:\n```json\n" + JSON.stringify(obj) + "\n```" } }] }),
    { status, headers: { "content-type": "application/json" } },
  );
}

function modelOutput(extra: Partial<Record<string, unknown>> = {}) {
  const qualities = Object.fromEntries(KEYS.map((k) => [k, { score: 2, reason: "weak", quotes: ["I have not done any sales job yet"] }]));
  qualities.skills = { score: 5, reason: "invented", quotes: ["I sold a million dollars of software"] };
  return {
    qualities: { ...qualities, ownership: { score: "3", reason: "ok", quotes: ["No, never."] } },
    must_have_results: [{ text: "2+ years B2B sales", met: false, quote: "No, never." }],
    flags: { other_role: "Office Assistant", culture_standout: false, wants_internship: "false", resume_mismatch: [], hr_review: null },
    summary: "Fresh graduate with no sales experience who does not enjoy customer calls.",
    profile_updates: null,
    short_exit: true,
    conduct_ended: false,
    callback_requested_at: "2026-11-16T16:00:00",
    ...extra,
  };
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

describe("scoreCall (mocked gateway)", () => {
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

  it("validates, verifies quotes, maps roles, anonymises, and resolves callback", async () => {
    fetchMock.mockResolvedValueOnce(reply(modelOutput()));
    const out = await scoreCall(input);
    expect(ScoreCallResultSchema.safeParse(out).success).toBe(true);
    expect(out.qualities.skills.score).toBeNull(); // invented quote dropped
    expect(out.qualities.experience.score).toBe(2);
    expect(out.qualities.ownership.score).toBe(3); // custom trait
    expect(out.flags.other_role).toEqual({ job_id: "job-2", title: "Office Assistant", reason: "" });
    expect(out.must_have_results[0]).toMatchObject({ met: false });
    expect(out.callback_requested_at).toBe("2026-11-16T16:00:00+05:30");
    expect(out.prompt_version).toMatch(/^score-v/);
    expect(out.model_version).toBe("claude-test");
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(JSON.stringify(body.messages)).not.toMatch(/Rohan|Mehta/);
    expect(body.temperature).toBeLessThanOrEqual(0.2);
    expect(fetchMock.mock.calls[0][0]).toBe("https://gateway.test/v1/chat/completions");
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer test-key");
  });

  it("retries without temperature on 400", async () => {
    fetchMock.mockResolvedValueOnce(new Response("bad", { status: 400 })).mockResolvedValueOnce(reply(modelOutput()));
    await scoreCall(input);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).temperature).toBeDefined();
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).temperature).toBeUndefined();
  });

  it("retries once on schema failure, then succeeds", async () => {
    const partial = modelOutput();
    delete (partial.qualities as Record<string, unknown>).storytelling;
    fetchMock.mockResolvedValueOnce(reply(partial)).mockResolvedValueOnce(reply(modelOutput()));
    const out = await scoreCall(input);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(out.qualities.storytelling).toBeDefined();
  });

  it("throws after a second schema failure", async () => {
    fetchMock.mockImplementation(async () => reply({ nope: true }));
    await expect(scoreCall(input)).rejects.toThrow(/schema/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("conduct_ended forces short_exit and the summary prefix", async () => {
    fetchMock.mockResolvedValueOnce(reply(modelOutput({ conduct_ended: true, short_exit: false, summary: "Abusive language after two warnings." })));
    const out = await scoreCall(input);
    expect(out.short_exit).toBe(true);
    expect(out.summary.startsWith("Call ended for conduct:")).toBe(true);
  });
});

describe("extractJson", () => {
  it("handles fences, prose and braces inside strings", () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('Sure! {"a":"x}y","b":{"c":2}} hope that helps')).toEqual({ a: "x}y", b: { c: 2 } });
    expect(() => extractJson("no json here")).toThrow();
  });
});
