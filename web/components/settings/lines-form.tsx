"use client";

import { useState } from "react";

/** Call lines for the whole company. Admins edit; everyone else reads. */
export function LinesForm({ initial, custom, fallback, canEdit, bounds }: { initial: number; custom: boolean; fallback: number; canEdit: boolean; bounds: { min: number; max: number } }) {
  const [saved, setSaved] = useState(initial);
  const [draft, setDraft] = useState(String(initial));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const n = Number(draft);
  const invalid = !Number.isInteger(n) || n < bounds.min || n > bounds.max;
  const dirty = n !== saved;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (invalid || !dirty) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/settings/lines", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ lines: n }) });
      const body = (await res.json().catch(() => ({}))) as { lines?: number; error?: string };
      if (!res.ok) setMsg({ ok: false, text: body.error ?? "Could not save. Try again." });
      else {
        setSaved(body.lines ?? n);
        setMsg({ ok: true, text: "Saved. The next calls use the new number of lines." });
      }
    } catch {
      setMsg({ ok: false, text: "Could not reach the server. Try again." });
    } finally {
      setBusy(false);
    }
  }

  const help = `How many calls can be on the phone at the same time, across all jobs. Match your Bolna plan. Allowed ${bounds.min}–${bounds.max}.`;

  return (
    <form onSubmit={save} noValidate>
      <div className="srow">
        <div>
          <b>
            <label htmlFor="lines-n">Call lines</label>
          </b>
          <p>
            {help}
            {!custom && saved === initial ? ` Using the server default of ${fallback}.` : ""}
          </p>
        </div>
        {canEdit ? (
          <span className="val num">
            <input
              id="lines-n"
              type="number"
              inputMode="numeric"
              min={bounds.min}
              max={bounds.max}
              step={1}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              aria-invalid={invalid ? true : undefined}
              style={{ width: 80, textAlign: "right" }}
            />{" "}
            lines
          </span>
        ) : (
          <span className="val num" id="lines-n">
            {saved} {saved === 1 ? "line" : "lines"}
          </span>
        )}
      </div>
      {canEdit ? (
        <div className="srow">
          <p role={(msg && !msg.ok) || invalid ? "alert" : undefined} aria-live="polite" className={(msg && !msg.ok) || invalid ? "state-bad" : undefined}>
            {invalid ? `Lines must be a whole number from ${bounds.min} to ${bounds.max}.` : (msg?.text ?? "Only admins can change this.")}
          </p>
          <button type="submit" className="btn sm" disabled={busy || !dirty || invalid}>
            {busy ? "Saving…" : "Save lines"}
          </button>
        </div>
      ) : null}
    </form>
  );
}
