/**
 * SMS / WhatsApp provider abstraction. Server only.
 *
 * MESSAGING_PROVIDER selects the adapter:
 *   log | console (default) — sends nothing; the message is stored with status "logged".
 *   twilio                  — implemented (REST API via fetch). Env: TWILIO_ACCOUNT_SID,
 *                             TWILIO_AUTH_TOKEN, and TWILIO_MESSAGING_SERVICE_SID or
 *                             TWILIO_FROM_NUMBER (SMS) / TWILIO_WHATSAPP_FROM (WhatsApp).
 *   msg91 | gupshup         — stubs (TODO), never "configured", so the log provider is used.
 * MESSAGING_CHANNEL = sms (default) | whatsapp.
 *
 * A selected provider that is not fully configured falls back to the log provider (nothing is
 * sent), and Settings says so. Plugging in a real key later is a config change only.
 */
import { randomUUID } from "node:crypto";

export type Channel = "sms" | "whatsapp";
export type ProviderName = "log" | "twilio" | "msg91" | "gupshup";
export type OutboundMessage = { to: string; body: string; channel: Channel };
export type SendResult = { status: "sent" | "failed" | "logged"; providerRef: string | null; error: string | null };

export interface MessagingProvider {
  name: ProviderName;
  label: string;
  /** true when send() really delivers to a phone */
  live: boolean;
  configured(): boolean;
  send(m: OutboundMessage): Promise<SendResult>;
}

const env = (k: string) => process.env[k]?.trim() || "";

// ---------- log (default) ----------
export const logProvider: MessagingProvider = {
  name: "log",
  label: "Log only (no SMS provider)",
  live: false,
  configured: () => true,
  async send() {
    return { status: "logged", providerRef: `log_${randomUUID()}`, error: null };
  },
};

// ---------- Twilio ----------
export const twilioProvider: MessagingProvider = {
  name: "twilio",
  label: "Twilio",
  live: true,
  configured() {
    const base = env("TWILIO_ACCOUNT_SID") && env("TWILIO_AUTH_TOKEN");
    if (!base) return false;
    return defaultChannel() === "whatsapp" ? Boolean(env("TWILIO_WHATSAPP_FROM")) : Boolean(env("TWILIO_MESSAGING_SERVICE_SID") || env("TWILIO_FROM_NUMBER"));
  },
  async send(m) {
    const sid = env("TWILIO_ACCOUNT_SID");
    const token = env("TWILIO_AUTH_TOKEN");
    const form = new URLSearchParams();
    if (m.channel === "whatsapp") {
      form.set("To", `whatsapp:${m.to}`);
      form.set("From", `whatsapp:${env("TWILIO_WHATSAPP_FROM").replace(/^whatsapp:/, "")}`);
    } else {
      form.set("To", m.to);
      if (env("TWILIO_MESSAGING_SERVICE_SID")) form.set("MessagingServiceSid", env("TWILIO_MESSAGING_SERVICE_SID"));
      else form.set("From", env("TWILIO_FROM_NUMBER"));
    }
    form.set("Body", m.body);
    try {
      const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: form.toString(),
        signal: AbortSignal.timeout(10_000),
      });
      const j = (await res.json().catch(() => null)) as { sid?: string; status?: string; code?: number; message?: string } | null;
      if (!res.ok || !j?.sid) {
        return { status: "failed", providerRef: null, error: `twilio_${res.status}${j?.code ? `_${j.code}` : ""}`.slice(0, 120) };
      }
      if (j.status === "failed" || j.status === "undelivered") return { status: "failed", providerRef: j.sid, error: `twilio_${j.status}` };
      return { status: "sent", providerRef: j.sid, error: null };
    } catch {
      return { status: "failed", providerRef: null, error: "twilio_network" };
    }
  },
};

// ---------- stubs ----------
function stub(name: ProviderName, label: string): MessagingProvider {
  return {
    name,
    label,
    live: true,
    // TODO(messaging): implement the adapter and report configured() from its env keys.
    configured: () => false,
    async send() {
      return { status: "failed", providerRef: null, error: `${name}_not_implemented` };
    },
  };
}
export const msg91Provider = stub("msg91", "MSG91");
export const gupshupProvider = stub("gupshup", "Gupshup");

// ---------- selection ----------
export function selectedProviderName(): ProviderName {
  const v = env("MESSAGING_PROVIDER").toLowerCase();
  if (v === "twilio" || v === "msg91" || v === "gupshup") return v;
  return "log"; // unset, "log", "console" or anything unknown
}

const BY_NAME: Record<ProviderName, MessagingProvider> = {
  log: logProvider,
  twilio: twilioProvider,
  msg91: msg91Provider,
  gupshup: gupshupProvider,
};

export function selectedProvider(): MessagingProvider {
  return BY_NAME[selectedProviderName()];
}

/** The adapter that actually sends: the selected one if fully configured, else the log provider. */
export function activeProvider(): MessagingProvider {
  const p = selectedProvider();
  return p.configured() ? p : logProvider;
}

export function defaultChannel(): Channel {
  return env("MESSAGING_CHANNEL").toLowerCase() === "whatsapp" ? "whatsapp" : "sms";
}

export const isProduction = () => process.env.NODE_ENV === "production";

/**
 * Phone verification on the apply form:
 *   on   — a real provider is configured; the code goes by SMS/WhatsApp.
 *   dev  — log provider outside production; the code is shown on screen.
 *   off  — log provider in production; no OTP (rate limits still apply). Settings shows a notice.
 */
export type OtpMode = "on" | "dev" | "off";
export function otpMode(): OtpMode {
  if (activeProvider().live) return "on";
  return isProduction() ? "off" : "dev";
}
