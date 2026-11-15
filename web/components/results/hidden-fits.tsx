"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { PICK_LABEL, initials, sourceLabel, type PickValue } from "@/components/candidate-format";
import type { PoolFlag, PoolRow } from "./server/data";

const GROUPS: { flag: PoolFlag; title: string; tint: string; blurb: string }[] = [
  { flag: "other_role", title: "Fits another role", tint: "t-green", blurb: "Better suited to a different opening." },
  { flag: "culture_standout", title: "Culture standout", tint: "t-blue", blurb: "The people a team would want, whatever the score." },
  { flag: "wants_internship", title: "Wants an internship", tint: "t-yellow", blurb: "Not ready for this role, ready to learn." },
  { flag: "resume_mismatch", title: "Resume doesn’t match", tint: "t-red", blurb: "What they wrote and what they said are far apart." },
];

export function HiddenFits({ rows, jobs, canMove }: { rows: PoolRow[]; jobs: { id: string; title: string; status: string }[]; canMove: boolean }) {
  return (
    <div className="groups">
      {GROUPS.map((g) => {
        const people = rows.filter((r) => r.flags.includes(g.flag));
        return (
          <section key={g.flag} className="card group" aria-labelledby={`g-${g.flag}`}>
            <div className="group-top">
              <h2 id={`g-${g.flag}`}>{g.title}</h2>
              <span className={`chip ${g.tint}`}>{people.length}</span>
            </div>
            <p>{g.blurb}</p>
            {people.length ? (
              people.map((r) => <Person key={r.candidate.id} r={r} flag={g.flag} jobs={jobs} canMove={canMove} />)
            ) : (
              <p className="empty" style={{ padding: "12px 0 16px", borderTop: "1px solid var(--color-line)" }}>
                Nobody here yet. People land here as their calls are scored.
              </p>
            )}
          </section>
        );
      })}
    </div>
  );
}

function Person({ r, flag, jobs, canMove }: { r: PoolRow; flag: PoolFlag; jobs: { id: string; title: string; status: string }[]; canMove: boolean }) {
  const router = useRouter();
  const targets = jobs.filter((j) => j.status === "open" && j.id !== r.job.id);
  const suggested = r.other_role?.job_id && targets.some((t) => t.id === r.other_role?.job_id) ? r.other_role.job_id : (targets[0]?.id ?? "");
  const [target, setTarget] = useState(suggested);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const why =
    flag === "resume_mismatch" && r.mismatch
      ? [r.mismatch.claim_quote ? `On the call: “${r.mismatch.claim_quote}”` : "", r.mismatch.resume_line ? `Resume says: ${r.mismatch.resume_line}` : ""]
          .filter(Boolean)
          .join(" · ")
      : flag === "other_role" && r.other_role
        ? `Fits ${r.other_role.title ?? "another role"}.${r.other_role.reason ? ` ${r.other_role.reason}` : ""}`
        : r.summary;

  async function move() {
    if (!target) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/candidates/${r.candidate.id}/actions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "move_to_job", target_job_id: target }),
      });
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        setMsg({ ok: false, text: data?.error ?? "Could not move them. Try again." });
        return;
      }
      setMsg({ ok: true, text: `On the ${targets.find((t) => t.id === target)?.title ?? ""} shortlist` });
      router.refresh();
    } catch {
      setMsg({ ok: false, text: "Could not reach Pingo. Try again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="gp">
      <div className="gp-top">
        <div className="who">
          <span className="av" aria-hidden="true">
            {initials(r.candidate.name)}
          </span>
          <div>
            <div className="nm">{r.candidate.name}</div>
            <div className="src">
              {r.job.title} · {sourceLabel(r.candidate.source)}
            </div>
          </div>
        </div>
        {r.pick ? <span className={`pick ${r.pick}`}>{PICK_LABEL[r.pick as PickValue]}</span> : null}
        <Link className="btn2 sm" href={`/candidates/${r.candidate.id}`} aria-label={`Open ${r.candidate.name}`}>
          Open
        </Link>
      </div>
      {why ? <p className="gp-why">{why}</p> : null}
      {r.moved_to ? (
        <div className="gp-move">
          <span className="ok">On the {r.moved_to.title} shortlist</span>
        </div>
      ) : canMove && (flag === "other_role" || flag === "culture_standout" || flag === "wants_internship") ? (
        <div className="gp-move">
          {targets.length ? (
            <>
              <select value={target} onChange={(e) => setTarget(e.target.value)} aria-label={`Job to move ${r.candidate.name} to`} disabled={busy}>
                {targets.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title}
                  </option>
                ))}
              </select>
              <button className="btn2 sm" type="button" onClick={move} disabled={busy || !target}>
                {busy ? "Moving" : "Move to shortlist"}
              </button>
            </>
          ) : (
            <span className="label">Open another job to move them there.</span>
          )}
          {msg ? (
            <span className={msg.ok ? "ok" : "bad"} role="status">
              {msg.text}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
