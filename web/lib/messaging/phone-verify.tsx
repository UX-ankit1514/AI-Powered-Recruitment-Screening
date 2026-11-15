"use client";

import { useState } from "react";

/**
 * Mobile number field for the public apply form, with optional 6-digit code verification.
 * Submits `phone` as before plus a hidden `phone_token` once verified (checked server-side by
 * lib/messaging/otp-gate.ts). mode "off" renders the plain field only.
 */
type Mode = "on" | "dev" | "off";
type Step =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "sent"; devCode?: string }
  | { kind: "verifying"; devCode?: string }
  | { kind: "verified"; token: string };

export function PhoneVerify({ jobId, mode, inputCls, labelCls }: { jobId: string; mode: Mode; inputCls: string; labelCls: string }) {
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<Step>({ kind: "idle" });
  const [error, setError] = useState("");

  const field = (
    <input
      id="ap-phone"
      name="phone"
      type="tel"
      required
      maxLength={40}
      autoComplete="tel"
      inputMode="tel"
      placeholder="+91 98765 43210"
      value={phone}
      onChange={(e) => {
        setPhone(e.target.value);
        if (step.kind !== "idle") setStep({ kind: "idle" });
        setCode("");
        setError("");
      }}
      className={`${inputCls} num text-[14px]`}
    />
  );

  if (mode === "off") {
    return (
      <div>
        <label htmlFor="ap-phone" className={labelCls}>Mobile number</label>
        {field}
      </div>
    );
  }

  async function post(path: string, body: Record<string, string>) {
    const res = await fetch(`/api/apply/otp/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    return { ok: res.ok, j: j ?? {} };
  }

  async function send() {
    if (!phone.trim() || step.kind === "sending") return;
    setError("");
    setStep({ kind: "sending" });
    try {
      const { ok, j } = await post("start", { job_id: jobId, phone });
      if (!ok) {
        setStep({ kind: "idle" });
        return setError(String(j.error ?? "Could not send the code. Try again."));
      }
      if (j.verification === "off") return setStep({ kind: "verified", token: "" });
      setStep({ kind: "sent", devCode: typeof j.dev_code === "string" ? j.dev_code : undefined });
    } catch {
      setStep({ kind: "idle" });
      setError("Could not reach Pingo. Check your connection and try again.");
    }
  }

  async function verify() {
    if (step.kind !== "sent" || !/^\d{6}$/.test(code)) return setError("Enter the 6-digit code");
    const devCode = step.devCode;
    setError("");
    setStep({ kind: "verifying", devCode });
    try {
      const { ok, j } = await post("verify", { job_id: jobId, phone, code });
      if (ok) return setStep({ kind: "verified", token: typeof j.phone_token === "string" ? j.phone_token : "" });
      setStep({ kind: "sent", devCode });
      setError(String(j.error ?? "That code did not work. Try again."));
    } catch {
      setStep({ kind: "sent", devCode });
      setError("Could not reach Pingo. Check your connection and try again.");
    }
  }

  const btn =
    "h-11 shrink-0 rounded-[10px] border border-line-strong bg-sunken px-3.5 text-[14px] font-medium text-text transition-colors hover:bg-line disabled:opacity-60";
  const codeStep = step.kind === "sent" || step.kind === "verifying";

  return (
    <div className="sm:col-span-2">
      <label htmlFor="ap-phone" className={labelCls}>Mobile number</label>
      <div className="flex gap-2">
        {field}
        {step.kind === "verified" ? (
          <span className="flex h-11 shrink-0 items-center rounded-[10px] bg-accent-soft px-3.5 text-[14px] font-medium text-accent-ink">Verified</span>
        ) : (
          <button type="button" onClick={send} disabled={!phone.trim() || step.kind === "sending"} className={btn}>
            {step.kind === "sending" ? "Sending" : codeStep ? "Resend" : "Send code"}
          </button>
        )}
      </div>
      {step.kind === "verified" && step.token ? <input type="hidden" name="phone_token" value={step.token} /> : null}

      {codeStep ? (
        <div className="mt-3">
          <label htmlFor="ap-code" className={labelCls}>6-digit code</label>
          <div className="flex gap-2">
            <input
              id="ap-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{6}"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void verify();
                }
              }}
              className={`${inputCls} num text-[15px] tracking-[0.3em]`}
            />
            <button type="button" onClick={verify} disabled={step.kind === "verifying" || code.length !== 6} className={btn}>
              {step.kind === "verifying" ? "Checking" : "Verify"}
            </button>
          </div>
          <p className="mt-1.5 text-[12.5px] text-text-3">
            {step.devCode ? (
              <>
                Test mode, no SMS sent. Your code is <span className="num font-semibold text-text">{step.devCode}</span>.
              </>
            ) : (
              "We sent a code to your number. It works for 10 minutes."
            )}
          </p>
        </div>
      ) : null}

      <p aria-live="polite" className={`mt-1.5 text-[12.5px] ${error ? "text-red" : "text-text-3"}`}>
        {error || (step.kind === "idle" ? "We send a 6-digit code to confirm it is your number." : "")}
      </p>
    </div>
  );
}
