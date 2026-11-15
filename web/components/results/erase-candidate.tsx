"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";

/**
 * Danger action on the candidate profile (admins only; the server checks again).
 * Permanently erases the candidate: calls, recordings, transcripts, scores, notes, resume.
 */
export function EraseCandidate({ candidateId, name }: { candidateId: string; name: string }) {
  const router = useRouter();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = typed.trim().toUpperCase() === "ERASE";

  async function erase() {
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/candidates/${candidateId}/erase`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirm: true }),
      });
      if (res.ok) {
        router.replace("/candidates");
        router.refresh();
        return;
      }
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? "Could not erase this candidate. Try again.");
    } catch {
      setError("Could not reach the server. Try again.");
    }
    setBusy(false);
  }

  return (
    <section className="card" aria-labelledby={`${id}-h`} style={{ marginTop: 20, padding: "16px 22px", borderColor: "var(--color-red-bg)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
        <div>
          <h2 id={`${id}-h`} style={{ fontSize: 15 }}>
            Erase candidate data
          </h2>
          <p className="muted" style={{ fontSize: 13, marginTop: 2 }}>
            For a candidate who asks to be deleted. Removes everything about {name}, for good.
          </p>
        </div>
        {!open ? (
          <button type="button" className="btn2 sm" style={{ color: "var(--color-red)" }} onClick={() => setOpen(true)}>
            Erase candidate data
          </button>
        ) : null}
      </div>

      {open ? (
        <div style={{ marginTop: 14 }}>
          <p style={{ fontSize: 13.5 }}>
            This permanently deletes {name}’s calls, recordings, transcripts, scores, notes and resume. It cannot be undone.
          </p>
          <label htmlFor={`${id}-c`} style={{ display: "block", fontSize: 13, marginTop: 10 }}>
            Type <b>ERASE</b> to confirm
          </label>
          <div style={{ display: "flex", gap: 10, marginTop: 6, flexWrap: "wrap" }}>
            <input id={`${id}-c`} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" disabled={busy} style={{ width: 160 }} />
            <button
              type="button"
              className="btn sm"
              style={{ background: "var(--color-red)", borderColor: "var(--color-red)" }}
              disabled={!ready || busy}
              onClick={erase}
            >
              {busy ? "Erasing…" : "Erase permanently"}
            </button>
            <button
              type="button"
              className="btn2 sm"
              disabled={busy}
              onClick={() => {
                setOpen(false);
                setTyped("");
                setError(null);
              }}
            >
              Cancel
            </button>
          </div>
          {error ? (
            <p className="err" role="alert" style={{ marginTop: 10 }}>
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
