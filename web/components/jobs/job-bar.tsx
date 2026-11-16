"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { IconLink } from "@/components/icons";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Top of the job page: the public apply link (copy and share as a plain URL) and closing / reopening
 * the job. Closing asks first, inline: waiting calls are cancelled, booked callbacks still happen
 * unless the recruiter chooses to cancel them too.
 */
export function JobBar({
  jobId,
  applyUrl,
  open,
  waiting,
  callbacks,
  canEdit,
}: {
  jobId: string;
  applyUrl: string;
  open: boolean;
  waiting: number;
  callbacks: number;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [dropCallbacks, setDropCallbacks] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function copy() {
    try {
      await navigator.clipboard.writeText(applyUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setMsg({ ok: false, text: "Could not copy. Select the link and copy it yourself." });
    }
  }

  async function close() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/jobs/${jobId}/close`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cancel_callbacks: dropCallbacks }),
      });
      const d = (await res.json().catch(() => ({}))) as { cancelled?: number; callbacks_kept?: number; error?: string };
      if (!res.ok) return setMsg({ ok: false, text: d.error ?? "Could not close the job. Try again." });
      const parts = [`Job closed. ${plural(d.cancelled ?? 0, "waiting call")} cancelled.`];
      if (d.callbacks_kept) parts.push(`${plural(d.callbacks_kept, "booked callback")} will still happen.`);
      setMsg({ ok: true, text: parts.join(" ") });
      setConfirming(false);
      router.refresh();
    } catch {
      setMsg({ ok: false, text: "Could not reach Pingo. Try again." });
    } finally {
      setBusy(false);
    }
  }

  async function reopen() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/jobs/${jobId}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: "open" }) });
      if (!res.ok) return setMsg({ ok: false, text: "Could not reopen the job. Try again." });
      setMsg({ ok: true, text: "Job reopened. The apply link works again." });
      router.refresh();
    } catch {
      setMsg({ ok: false, text: "Could not reach Pingo. Try again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card jobbar" aria-label="Apply link and job status">
      <div className="jobbar-link">
        <div className="jobbar-title">
          <IconLink />
          <h2 id="jb-link">Share apply link</h2>
          <span className={open ? "chip accent" : "chip"}>{open ? "Open" : "Closed"}</span>
        </div>
        <p className="hint">
          {open
            ? "Post this link anywhere: job boards, WhatsApp, your careers page. Applicants fill a short form and get a screening call."
            : "This job is closed, so the link shows applicants that the role is not open."}
        </p>
        <div className="jobbar-copy">
          <input readOnly value={applyUrl} aria-labelledby="jb-link" onFocus={(e) => e.currentTarget.select()} />
          <button type="button" className="btn2 sm" onClick={copy} aria-live="polite">
            {copied ? "Copied" : "Copy link"}
          </button>
        </div>
      </div>

      {canEdit ? (
        <div className="jobbar-close">
          {open ? (
            confirming ? (
              <div className="jobbar-confirm" role="group" aria-labelledby="jb-confirm">
                <b id="jb-confirm">Close this job?</b>
                <p>
                  New applications stop and {plural(waiting, "waiting call")} {waiting === 1 ? "is" : "are"} cancelled. Calls already on the line finish.
                  {callbacks && !dropCallbacks ? ` ${plural(callbacks, "booked callback")} will still happen.` : ""}
                </p>
                {callbacks ? (
                  <label className="chk">
                    <input type="checkbox" checked={dropCallbacks} onChange={(e) => setDropCallbacks(e.target.checked)} />
                    <span>Also cancel the {plural(callbacks, "booked callback")}</span>
                  </label>
                ) : null}
                <div className="btnrow">
                  <button type="button" className="btn sm" onClick={close} disabled={busy}>
                    {busy ? "Closing…" : "Close job"}
                  </button>
                  <button type="button" className="btn2 sm" onClick={() => setConfirming(false)} disabled={busy}>
                    Keep it open
                  </button>
                </div>
              </div>
            ) : (
              <button type="button" className="btn2 sm" onClick={() => setConfirming(true)}>
                Close job
              </button>
            )
          ) : (
            <button type="button" className="btn2 sm" onClick={reopen} disabled={busy}>
              {busy ? "Reopening…" : "Reopen job"}
            </button>
          )}
        </div>
      ) : null}

      {msg ? (
        <p className={msg.ok ? "note jobbar-msg" : "err jobbar-msg"} role={msg.ok ? "status" : "alert"}>
          {msg.text}
        </p>
      ) : null}
    </section>
  );
}
