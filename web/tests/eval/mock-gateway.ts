/**
 * Deterministic stand-in for the AI gateway used by the mocked eval and unit tests.
 * It answers each evaluation pass (routed by the "PASS:" line of the system prompt) from a case's
 * "truth": what a careful evaluator would extract and score. The PIPELINE still does all the real
 * work: quote verification, coverage rules, renormalisation, two-pass agreement, must-have caps,
 * folding, confidence, pick. Quotes in the truth that are not in the transcript (gaming case) must be
 * dropped by the pipeline, exactly as with a real model.
 */
export type TruthEvidence = { c?: "asked_answered" | "asked_weak" | "not_asked"; q: string[]; s: number | null; s2?: number | null; note?: string };
export type Truth = {
  classify?: { call_class?: string; short_exit?: boolean; conduct_ended?: boolean; gaming_attempt?: boolean; callback_requested_at?: string | null; reason?: string };
  evidence: Record<string, TruthEvidence>;
  must?: Record<string, { status: "met" | "not_met" | "unclear"; quote: string | null }>;
  flags?: Record<string, unknown>;
  summary?: { strengths?: string[]; gaps?: string[]; hidden_fits?: { title: string; reason: string }[]; rationale?: string; summary?: string };
};

type Body = { messages: { role: string; content: string }[]; temperature?: number };

export type GatewayLog = { pass: string; temperature: number | undefined; user: string }[];

function reply(obj: unknown) {
  return new Response(JSON.stringify({ model: "mock-evaluator", choices: [{ message: { content: JSON.stringify(obj) } }] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/** Section of the user prompt between a heading line and the next blank line. */
function idsUnder(user: string, heading: RegExp): string[] {
  const lines = user.split("\n");
  const start = lines.findIndex((l) => heading.test(l));
  if (start < 0) return [];
  const out: string[] = [];
  for (let i = start + 1; i < lines.length && lines[i].trim(); i++) {
    const m = /^- ([a-z][a-z0-9_]*):/.exec(lines[i]);
    if (m) out.push(m[1]);
  }
  return out;
}

export function makeMockFetch(truth: Truth, log?: GatewayLog) {
  return async (_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const body = JSON.parse(String(init?.body ?? "{}")) as Body;
    const system = body.messages.find((m) => m.role === "system")?.content ?? "";
    const user = body.messages.filter((m) => m.role === "user").map((m) => m.content).join("\n");
    const pass = /^PASS: ([a-z0-9-]+)/.exec(system)?.[1] ?? "unknown";
    log?.push({ pass, temperature: body.temperature, user });

    if (pass === "classify") {
      const c = truth.classify ?? {};
      return reply({
        call_class: c.call_class ?? "conversation",
        reason: c.reason ?? "",
        short_exit: !!c.short_exit,
        conduct_ended: !!c.conduct_ended,
        gaming_attempt: !!c.gaming_attempt,
        callback_requested_at: c.callback_requested_at ?? null,
      });
    }
    if (pass === "evidence") {
      const ids = idsUnder(user, /^Criteria \(return evidence/);
      const checks = idsUnder(user, /^Must-have checks/);
      const evidence = Object.fromEntries(
        ids.map((id) => {
          const t = truth.evidence[id];
          return [id, t ? { coverage: t.c ?? "asked_answered", quotes: t.q, note: t.note ?? "" } : { coverage: "not_asked", quotes: [], note: "" }];
        }),
      );
      const must_haves = Object.fromEntries(checks.map((id) => [id, truth.must?.[id] ?? { status: "unclear", quote: null }]));
      return reply({
        evidence,
        must_haves,
        flags: { other_role: null, culture_standout: false, wants_internship: false, resume_mismatch: [], hr_review: null, ...(truth.flags ?? {}) },
        profile_updates: null,
      });
    }
    if (pass === "score-1" || pass === "score-2") {
      const ids = [...user.matchAll(/^- ([a-z][a-z0-9_]*): .*\[(asked_answered|asked_weak)\]$/gm)].map((m) => m[1]);
      const scores = Object.fromEntries(
        ids.map((id) => {
          const t = truth.evidence[id];
          const s = pass === "score-2" && t && t.s2 !== undefined ? t.s2 : (t?.s ?? null);
          return [id, { score: s, justification: t?.q[0] ? `Candidate said "${t.q[0].split(" ").slice(0, 8).join(" ")}".` : "Little evidence." }];
        }),
      );
      return reply({ scores });
    }
    if (pass === "summary") {
      const s = truth.summary ?? {};
      return reply({ strengths: s.strengths ?? [], gaps: s.gaps ?? [], hidden_fits: s.hidden_fits ?? [], rationale: s.rationale ?? "", summary: s.summary ?? "" });
    }
    return new Response("unexpected pass", { status: 500 });
  };
}
