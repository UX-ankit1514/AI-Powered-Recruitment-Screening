/** Pure M6 logic: status mapping, outcome classification, slots, secret compare. No network. */
import { describe, expect, it } from "vitest";
import { classifyTerminal, factsOf, hadConversation, liveState } from "../../lib/calls/outcome";
import { candidateSlots, inCallingHours, pickSlots, slotIso, slotLabel, slotSpoken } from "../../lib/calls/slots";
import { safeEqual } from "../../lib/calls/secret";
import { DIALABLE_PHONE } from "../../lib/calls/config";

const TALK = "assistant: Hi, am I speaking with Rahul?\nuser: Yes, this is Rahul.\nassistant: Great.";
const f = (status: string, terminationReason: string | null, conversationSeconds = 0, transcript = "") => ({
  status,
  terminationReason,
  conversationSeconds,
  transcript,
});

describe("status mapping", () => {
  it("live statuses", () => {
    for (const s of ["scheduled", "queued", "initiated", "ringing"]) expect(liveState(s)).toBe("dialing");
    expect(liveState("in-progress")).toBe("in_call");
    expect(liveState("call-disconnected")).toBe("in_call");
    expect(liveState("rescheduled")).toBeNull();
  });

  it("terminal outcomes and retries", () => {
    expect(classifyTerminal(f("completed", "voicemail_reached"))).toEqual({ outcome: "voicemail", retry: true, score: false });
    expect(classifyTerminal(f("no-answer", "no_answer"))).toEqual({ outcome: "no_answer", retry: true, score: false });
    expect(classifyTerminal(f("no-answer", null))).toEqual({ outcome: "no_answer", retry: true, score: false });
    expect(classifyTerminal(f("busy", "busy"))).toEqual({ outcome: "busy", retry: true, score: false });
    expect(classifyTerminal(f("busy", null)).outcome).toBe("busy");
    expect(classifyTerminal(f("failed", "invalid_number"))).toEqual({ outcome: "failed", retry: false, score: false });
    expect(classifyTerminal(f("canceled", "canceled_via_api")).retry).toBe(false);
    expect(classifyTerminal(f("balance-low", "insufficient_balance"))).toEqual({ outcome: "failed", retry: true, score: false });
    expect(classifyTerminal(f("completed", "agent_ended_call", 140, TALK))).toEqual({ outcome: "completed", retry: false, score: true });
    expect(classifyTerminal(f("completed", "max_duration_reached", 600, TALK)).outcome).toBe("completed");
    expect(classifyTerminal(f("completed", "inactivity_timeout", 20, "assistant: Hello?\nassistant: Hello?")).outcome).toBe("dropped");
    expect(classifyTerminal(f("completed", "user_hung_up", 0, ""))).toEqual({ outcome: "no_answer", retry: true, score: false });
    expect(classifyTerminal(f("completed", "agent_llm_error", 30, TALK))).toEqual({ outcome: "dropped", retry: true, score: true });
    expect(classifyTerminal(f("completed", "declined", 30, TALK)).outcome).toBe("declined");
  });

  it("completed without a user line is not a conversation", () => {
    expect(hadConversation({ conversationSeconds: 50, transcript: "assistant: hi" })).toBe(false);
    expect(hadConversation({ conversationSeconds: 0, transcript: TALK })).toBe(false);
    expect(hadConversation({ conversationSeconds: 5, transcript: TALK })).toBe(true);
  });

  it("reads payload fields (cost in cents as given)", () => {
    const x = factsOf({
      status: "completed",
      termination_reason: "agent_ended_call",
      conversation_duration: 121.6,
      total_cost: 7.25,
      transcript: TALK,
      telephony_data: { duration: "130", recording_url: "https://rec/1.mp3" },
    });
    expect(x).toMatchObject({ durationSeconds: 122, costCents: 7.25, recordingUrl: "https://rec/1.mp3", conversationSeconds: 121.6 });
  });
});

describe("calling hours and slots (IST)", () => {
  const hours = { start: "10:00", end: "19:00", days: [1, 2, 3, 4, 5, 6] };
  it("inCallingHours", () => {
    expect(inCallingHours(hours, new Date("2026-11-16T04:30:00Z"))).toBe(true); // Mon 10:00 IST
    expect(inCallingHours(hours, new Date("2026-11-16T04:29:00Z"))).toBe(false); // Mon 09:59
    expect(inCallingHours(hours, new Date("2026-11-16T13:30:00Z"))).toBe(false); // Mon 19:00 (end exclusive)
    expect(inCallingHours(hours, new Date("2026-11-15T06:00:00Z"))).toBe(false); // Sunday
    expect(inCallingHours({ start: "10:00", end: "19:00", days: [7] }, new Date("2026-11-15T06:00:00Z"))).toBe(true);
    expect(inCallingHours({ days: [] }, new Date("2026-11-16T06:00:00Z"))).toBe(false);
  });

  it("offers 3 spaced on-the-hour slots inside hours, skipping full ones", () => {
    const now = new Date("2026-11-16T05:10:00Z"); // Mon 10:40 IST
    const all = candidateSlots(hours, now);
    expect(slotIso(all[0]!)).toBe("2026-11-16T06:30:00Z"); // Mon 12:00 IST (>= 1h lead, on the IST hour)
    for (const d of all) expect(inCallingHours(hours, d)).toBe(true);
    const full = new Set(["2026-11-16T06:30:00.000Z"]);
    const picked = pickSlots(hours, now, (d) => !full.has(d.toISOString()));
    expect(picked.map(slotIso)).toEqual(["2026-11-16T07:30:00Z", "2026-11-16T10:30:00Z", "2026-11-17T04:30:00Z"]);
    expect(picked.map((d) => slotLabel(d, now))).toEqual(["today 1 pm", "today 4 pm", "tomorrow 10 am"]);
    expect(slotSpoken(new Date("2026-11-19T08:30:00Z"), now)).toBe("Thursday at 2 pm");
  });
});

describe("safety + secrets", () => {
  it("only Indian mobiles are dialable", () => {
    expect(DIALABLE_PHONE.test("+919876543210")).toBe(true);
    expect(DIALABLE_PHONE.test("+915876543210")).toBe(false);
    expect(DIALABLE_PHONE.test("+15550100123")).toBe(false);
    expect(DIALABLE_PHONE.test("+9198765432101")).toBe(false);
  });
  it("safeEqual", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("", "")).toBe(false);
    expect(safeEqual(null, "x")).toBe(false);
  });
});
