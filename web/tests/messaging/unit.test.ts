/** Messaging unit tests: provider selection, Twilio adapter, signed tokens, masking, OTP gate. No network, no DB. */
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  activeProvider,
  defaultChannel,
  otpMode,
  selectedProvider,
  selectedProviderName,
  twilioProvider,
} from "../../lib/messaging/provider";
import {
  MissingSecretError,
  phoneHash,
  signPhoneToken,
  signPickToken,
  verifyPhoneToken,
  verifyPickToken,
} from "../../lib/messaging/crypto";
import { maskBody, maskPhone } from "../../lib/messaging/mask";
import { firstName, headsUpBody } from "../../lib/messaging/heads-up";
import { requireVerifiedPhone } from "../../lib/messaging/otp-gate";

vi.mock("server-only", () => ({}));
vi.mock("../../lib/supabase/admin", () => ({
  createAdminClient: () => {
    throw new Error("no DB in unit tests");
  },
}));

const SECRET = "unit-test-secret-0123456789-abcdefghijklmnopqrstuvwxyz";
const MSG_ENV = [
  "MESSAGING_PROVIDER",
  "MESSAGING_CHANNEL",
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "TWILIO_FROM_NUMBER",
  "TWILIO_MESSAGING_SERVICE_SID",
  "TWILIO_WHATSAPP_FROM",
];

beforeEach(() => {
  vi.stubEnv("PICK_TIME_SECRET", SECRET);
  for (const k of MSG_ENV) vi.stubEnv(k, "");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function twilioEnv() {
  vi.stubEnv("TWILIO_ACCOUNT_SID", "ACtest");
  vi.stubEnv("TWILIO_AUTH_TOKEN", "tok");
  vi.stubEnv("TWILIO_FROM_NUMBER", "+15005550006");
}

describe("provider selection", () => {
  it("defaults to the log provider", () => {
    expect(selectedProviderName()).toBe("log");
    expect(activeProvider().name).toBe("log");
    expect(activeProvider().live).toBe(false);
    expect(defaultChannel()).toBe("sms");
  });

  it("treats console and unknown values as log", () => {
    vi.stubEnv("MESSAGING_PROVIDER", "console");
    expect(selectedProviderName()).toBe("log");
    vi.stubEnv("MESSAGING_PROVIDER", "carrier-pigeon");
    expect(selectedProviderName()).toBe("log");
  });

  it("twilio without keys is selected but falls back to log", () => {
    vi.stubEnv("MESSAGING_PROVIDER", "twilio");
    expect(selectedProvider().name).toBe("twilio");
    expect(selectedProvider().configured()).toBe(false);
    expect(activeProvider().name).toBe("log");
  });

  it("twilio with keys is active and live", () => {
    vi.stubEnv("MESSAGING_PROVIDER", "Twilio");
    twilioEnv();
    expect(activeProvider().name).toBe("twilio");
    expect(otpMode()).toBe("on");
  });

  it("whatsapp channel needs a WhatsApp sender", () => {
    vi.stubEnv("MESSAGING_PROVIDER", "twilio");
    vi.stubEnv("MESSAGING_CHANNEL", "whatsapp");
    twilioEnv();
    expect(twilioProvider.configured()).toBe(false);
    vi.stubEnv("TWILIO_WHATSAPP_FROM", "+14155238886");
    expect(twilioProvider.configured()).toBe(true);
  });

  it("msg91 and gupshup are stubs that never send", async () => {
    for (const name of ["msg91", "gupshup"]) {
      vi.stubEnv("MESSAGING_PROVIDER", name);
      expect(selectedProvider().name).toBe(name);
      expect(activeProvider().name).toBe("log");
      expect((await selectedProvider().send({ to: "+919876543210", body: "x", channel: "sms" })).status).toBe("failed");
    }
  });

  it("OTP mode: dev outside production, off in production with the log provider", () => {
    expect(otpMode()).toBe("dev");
    vi.stubEnv("NODE_ENV", "production");
    expect(otpMode()).toBe("off");
    vi.stubEnv("MESSAGING_PROVIDER", "twilio");
    twilioEnv();
    expect(otpMode()).toBe("on");
  });
});

describe("twilio adapter", () => {
  it("posts form data with basic auth and returns the message sid", async () => {
    twilioEnv();
    const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(async () => new Response(JSON.stringify({ sid: "SM123", status: "queued" }), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    const r = await twilioProvider.send({ to: "+919876543210", body: "hello", channel: "sms" });
    expect(r).toEqual({ status: "sent", providerRef: "SM123", error: null });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.twilio.com/2010-04-01/Accounts/ACtest/Messages.json");
    expect((init.headers as Record<string, string>).Authorization).toBe(`Basic ${Buffer.from("ACtest:tok").toString("base64")}`);
    const form = new URLSearchParams(String(init.body));
    expect(form.get("To")).toBe("+919876543210");
    expect(form.get("From")).toBe("+15005550006");
    expect(form.get("Body")).toBe("hello");
  });

  it("uses whatsapp: prefixes on the WhatsApp channel", async () => {
    twilioEnv();
    vi.stubEnv("TWILIO_WHATSAPP_FROM", "+14155238886");
    const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(async () => new Response(JSON.stringify({ sid: "SM9" }), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    await twilioProvider.send({ to: "+919876543210", body: "hi", channel: "whatsapp" });
    const form = new URLSearchParams(String(fetchMock.mock.calls[0]![1].body));
    expect(form.get("To")).toBe("whatsapp:+919876543210");
    expect(form.get("From")).toBe("whatsapp:+14155238886");
  });

  it("maps API errors and network errors to failed", async () => {
    twilioEnv();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ code: 21211, message: "bad To" }), { status: 400 })));
    expect(await twilioProvider.send({ to: "+919876543210", body: "x", channel: "sms" })).toMatchObject({ status: "failed", error: "twilio_400_21211" });
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("down"))));
    expect(await twilioProvider.send({ to: "+919876543210", body: "x", channel: "sms" })).toMatchObject({ status: "failed", error: "twilio_network" });
  });
});

describe("pick-time token", () => {
  const callId = randomUUID();

  it("round-trips and is short enough for SMS", () => {
    const t = signPickToken(callId);
    expect(t).toMatch(/^[A-Za-z0-9_-]{50}$/);
    const v = verifyPickToken(t);
    expect(v.ok && v.value.callId).toBe(callId);
  });

  it("expires", () => {
    const t = signPickToken(callId, new Date(), 60);
    expect(verifyPickToken(t, new Date(Date.now() + 61_000))).toEqual({ ok: false, reason: "expired" });
  });

  it("rejects tampering, wrong secrets and junk", () => {
    const t = signPickToken(callId);
    for (const i of [0, 1, 7, 20, 30, 40, 48, 49]) {
      const c = t[i] === "A" ? "B" : "A";
      expect(verifyPickToken(t.slice(0, i) + c + t.slice(i + 1)).ok).toBe(false);
    }
    vi.stubEnv("PICK_TIME_SECRET", `${SECRET}-other`);
    expect(verifyPickToken(t)).toEqual({ ok: false, reason: "invalid" });
    expect(verifyPickToken("abc").ok).toBe(false);
    expect(verifyPickToken(null).ok).toBe(false);
  });

  it("refuses to sign without a strong secret", () => {
    vi.stubEnv("PICK_TIME_SECRET", "short");
    expect(() => signPickToken(callId)).toThrow(MissingSecretError);
  });
});

describe("verified-phone token", () => {
  const jobId = randomUUID();
  it("round-trips, expires and rejects tampering", () => {
    const ph = phoneHash("+919876543210");
    const t = signPhoneToken(ph, jobId);
    const v = verifyPhoneToken(t);
    expect(v.ok && v.value).toEqual({ phoneHash: ph, jobId });
    expect(verifyPhoneToken(signPhoneToken(ph, jobId, new Date(), 1), new Date(Date.now() + 2000))).toEqual({ ok: false, reason: "expired" });
    const [p, s] = t.split(".");
    const forged = Buffer.from(JSON.stringify({ p: ph, j: randomUUID(), e: 9_999_999_999 })).toString("base64url");
    expect(verifyPhoneToken(`${forged}.${s}`).ok).toBe(false);
    expect(verifyPhoneToken(`${p}.${s}x`).ok).toBe(false);
  });
  it("a pick-time token is not a phone token", () => {
    expect(verifyPhoneToken(signPickToken(randomUUID())).ok).toBe(false);
  });
});

describe("masking and copy", () => {
  it("masks phone numbers", () => {
    expect(maskPhone("+919876543210")).toBe("+91 98••• ••210");
    expect(maskPhone("+15550101234")).toBe("+1 ••••••234");
    expect(maskPhone("junk")).toBe("••••");
  });
  it("masks link tokens and codes in bodies", () => {
    const b = maskBody("123456 is your code. Pick one: https://x.app/pick-time/AbC_-123xyz");
    expect(b).not.toContain("123456");
    expect(b).not.toContain("AbC_-123xyz");
    expect(b).toContain("/pick-time/•••");
  });
  it("builds the heads-up text", () => {
    expect(headsUpBody({ firstName: firstName("Rahul  Sharma"), company: "Acme SaaS", role: "Sales Executive", link: "https://p/x" })).toBe(
      "Hi Rahul, this is Acme SaaS about your Sales Executive application. Aditi from our hiring team will call you shortly for a 10-minute chat. Prefer another time? Pick one: https://p/x",
    );
  });
});

describe("apply OTP gate", () => {
  const jobId = randomUUID();
  const req = (fields: Record<string, string>) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    return new Request("http://localhost/api/apply/x", { method: "POST", body: fd });
  };
  const token = (phone = "+919876543210", job = jobId, ttl?: number) => signPhoneToken(phoneHash(phone), job, new Date(), ttl);

  it("requires a token for the same phone and job", async () => {
    expect((await requireVerifiedPhone(req({ phone: "9876543210" }), jobId))?.status).toBe(400);
    expect(await requireVerifiedPhone(req({ phone: "98765 43210", phone_token: token() }), jobId)).toBeNull();
    expect((await requireVerifiedPhone(req({ phone: "9876543211", phone_token: token() }), jobId))?.status).toBe(400);
    expect((await requireVerifiedPhone(req({ phone: "9876543210", phone_token: token("+919876543210", randomUUID()) }), jobId))?.status).toBe(400);
  });

  it("explains an expired verification", async () => {
    const res = await requireVerifiedPhone(req({ phone: "9876543210", phone_token: token("+919876543210", jobId, 1) }), jobId, new Date(Date.now() + 5000));
    expect(res?.status).toBe(400);
    expect(((await res!.json()) as { error: string }).error).toMatch(/expired/);
  });

  it("defers honeypot and bad phones to the apply handler", async () => {
    expect(await requireVerifiedPhone(req({ phone: "9876543210", website: "spam" }), jobId)).toBeNull();
    expect(await requireVerifiedPhone(req({ phone: "abc" }), jobId)).toBeNull();
  });

  it("is skipped when phone verification is off (log provider in production)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(await requireVerifiedPhone(req({ phone: "9876543210" }), jobId)).toBeNull();
  });
});
