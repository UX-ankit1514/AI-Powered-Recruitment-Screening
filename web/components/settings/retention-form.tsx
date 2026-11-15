"use client";

import { useState } from "react";

type Bounds = { recording_days: { min: number; max: number }; transcript_days: { min: number; max: number } };
type Value = { recording_days: number; transcript_days: number };

const ROWS = [
  { key: "recording_days", label: "Call recordings", help: "Audio of each call." },
  { key: "transcript_days", label: "Transcripts and scores", help: "What was said, the scores and the quotes behind them." },
] as const;

export function RetentionForm({ initial, canEdit, bounds }: { initial: Value; canEdit: boolean; bounds: Bounds }) {
  const [saved, setSaved] = useState(initial);
  const [draft, setDraft] = useState({ recording_days: String(initial.recording_days), transcript_days: String(initial.transcript_days) });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const parsed = { recording_days: Number(draft.recording_days), transcript_days: Number(draft.transcript_days) };
  const invalid = ROWS.find(({ key }) => {
    const n = parsed[key];
    return !Number.isInteger(n) || n < bounds[key].min || n > bounds[key].max;
  });
  const dirty = parsed.recording_days !== saved.recording_days || parsed.transcript_days !== saved.transcript_days;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (invalid || !dirty) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/settings/retention", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(parsed),
      });
      const body = (await res.json().catch(() => ({}))) as Partial<Value> & { error?: string };
      if (!res.ok) {
        setMsg({ ok: false, text: body.error ?? "Could not save. Try again." });
      } else {
        const next = { recording_days: body.recording_days ?? parsed.recording_days, transcript_days: body.transcript_days ?? parsed.transcript_days };
        setSaved(next);
        setMsg({ ok: true, text: "Saved. Tonight’s clean-up uses the new limits." });
      }
    } catch {
      setMsg({ ok: false, text: "Could not reach the server. Try again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} noValidate>
      {ROWS.map(({ key, label, help }) => (
        <div className="srow" key={key}>
          <div>
            <b>
              <label htmlFor={`ret-${key}`}>{label}</label>
            </b>
            <p>
              {help} Allowed {bounds[key].min}–{bounds[key].max} days.
            </p>
          </div>
          {canEdit ? (
            <span className="val num">
              <input
                id={`ret-${key}`}
                type="number"
                inputMode="numeric"
                min={bounds[key].min}
                max={bounds[key].max}
                step={1}
                value={draft[key]}
                onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
                aria-invalid={invalid?.key === key ? true : undefined}
                style={{ width: 96, textAlign: "right" }}
              />{" "}
              days
            </span>
          ) : (
            <span className="val num" id={`ret-${key}`}>
              {saved[key]} days
            </span>
          )}
        </div>
      ))}
      <div className="srow">
        {canEdit ? (
          <>
            <p role={msg && !msg.ok ? "alert" : undefined} aria-live="polite" className={msg && !msg.ok ? "state-bad" : undefined}>
              {invalid
                ? `${invalid.label} must be between ${bounds[invalid.key].min} and ${bounds[invalid.key].max} days.`
                : (msg?.text ?? "Only admins can change these limits.")}
            </p>
            <button type="submit" className="btn sm" disabled={busy || !dirty || Boolean(invalid)}>
              {busy ? "Saving…" : "Save limits"}
            </button>
          </>
        ) : (
          <p>Only admins can change these limits.</p>
        )}
      </div>
    </form>
  );
}
