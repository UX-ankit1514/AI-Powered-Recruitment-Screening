"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { PICK_LABEL, callText, initials, mmss, sourceLabel, type PickValue } from "@/components/candidate-format";
import { resumeGap, resumeWouldDrop } from "./model";
import type { Profile } from "./server/data";

const PICKS: PickValue[] = ["amazing", "good", "maybe", "no"];

const when = (iso: string | null) =>
  iso
    ? new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" }).format(new Date(iso))
    : "—";

/** "83", 83, "1:23", "00:01:23" → seconds; null when unusable. */
function tsSeconds(ts: number | string | null): number | null {
  if (typeof ts === "number") return Number.isFinite(ts) && ts >= 0 ? ts : null;
  if (typeof ts !== "string" || !ts.trim()) return null;
  const parts = ts.trim().split(":").map(Number);
  if (parts.some((n) => !Number.isFinite(n) || n < 0)) return null;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

type Line = { who: "a" | "c" | null; text: string };
function parseTranscript(t: string): Line[] {
  const out: Line[] = [];
  for (const raw of t.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const a = line.match(/^(assistant|agent|bot|aditi|ai|interviewer)\s*:\s*(.*)$/i);
    const c = line.match(/^(user|candidate|human|customer|caller)\s*:\s*(.*)$/i);
    if (a) out.push({ who: "a", text: a[2] });
    else if (c) out.push({ who: "c", text: c[2] });
    else if (out.length) out[out.length - 1].text += ` ${line}`;
    else out.push({ who: null, text: line });
  }
  return out;
}
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9ऀ-ॿ]+/g, " ").trim();

const KIND_LABEL: Record<string, string> = { phone: "Phone", web: "Browser" };

export function ProfileView({ p, canEdit, meIsHm }: { p: Profile; canEdit: boolean; meIsHm: boolean }) {
  const router = useRouter();
  const audio = useRef<HTMLAudioElement>(null);
  const txRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [note, setNote] = useState("");
  const [hit, setHit] = useState<number | null>(null);

  const { candidate: c, result: r } = p;
  const lines = useMemo(() => (p.transcript ? parseTranscript(p.transcript) : []), [p.transcript]);
  const weights = p.rubric?.weights ?? {};
  const totalW = Object.values(weights).reduce((a, b) => a + (b > 0 ? b : 0), 0) || 1;
  const gap = resumeGap(c.resume_only_score, r.overall);
  const latestCall = p.calls.length ? p.calls[p.calls.length - 1] : null;
  const call = callText(latestCall ? { state: latestCall.state, outcome: latestCall.outcome, durationS: latestCall.duration_s, attempt: latestCall.attempt } : null);
  const decided = c.status === "shortlisted" || c.status === "rejected" ? c.status : null;
  const jobTitles = new Map(p.other_jobs.map((j) => [j.id, j.title]));

  async function act(body: Record<string, unknown>, done: string) {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/candidates/${c.id}/actions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        setMsg({ ok: false, text: data?.error ?? "That did not save. Try again." });
        return false;
      }
      setMsg({ ok: true, text: done });
      router.refresh();
      return true;
    } catch {
      setMsg({ ok: false, text: "Could not reach Pingo. Check your connection and try again." });
      return false;
    } finally {
      setBusy(false);
    }
  }

  function playQuote(text: string, ts: number | string | null) {
    const s = tsSeconds(ts);
    if (audio.current && s !== null) {
      audio.current.currentTime = s;
      void audio.current.play().catch(() => undefined);
    }
    const n = norm(text);
    const idx = n ? lines.findIndex((l) => norm(l.text).includes(n.slice(0, 60))) : -1;
    setHit(idx >= 0 ? idx : null);
    if (idx >= 0) {
      const el = txRef.current?.querySelector<HTMLElement>(`[data-line="${idx}"]`);
      el?.scrollIntoView({ block: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    }
  }
  const canSeek = Boolean(p.recording_signed_url) || lines.length > 0;

  return (
    <>
      <Link className="back" href={`/candidates?job=${c.job_id}`}>
        <svg className="i" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M15 18l-6-6 6-6" />
        </svg>
        All candidates for {p.job.title}
      </Link>

      <div className="card prof-head">
        <span className="av" aria-hidden="true">
          {initials(c.name)}
        </span>
        <div>
          <h1>{c.name}</h1>
          <div className="prof-meta">
            {r.pick ? <span className={`pick ${r.pick}`}>{PICK_LABEL[r.pick]}</span> : <span className="status">{c.status === "ats_filtered" ? "ATS filtered, not called" : "Not scored yet"}</span>}
            <span>{sourceLabel(c.source)}</span>
            <span>
              {call.text}
              {call.duration ? (
                <>
                  {" · "}
                  <span className="num">{call.duration}</span>
                </>
              ) : null}
            </span>
            {r.override ? (
              <span className="label">
                Pick changed by the team (scored {r.scored_pick ? PICK_LABEL[r.scored_pick] : "n/a"})
              </span>
            ) : r.held ? (
              <span className="label">Held at Maybe: {r.held}</span>
            ) : null}
            {resumeWouldDrop(c.resume_only_score, r.overall) ? <span className="chip hook">Resume filter would have dropped</span> : null}
          </div>
        </div>
        <div className="bigscore">
          <div className="label">Call score{p.rubric ? ` · rubric v${p.rubric.version}` : ""}</div>
          <span className="num">{r.overall ?? "—"}</span>
          <span className="gapline">
            Resume only <b>{gap.resume ?? "n/a"}</b>
            {gap.call !== null ? (
              <>
                {" "}
                → Call <b>{gap.call}</b>
              </>
            ) : null}
            {gap.delta ? (
              <span className={`delta ${gap.delta > 0 ? "up" : "down"}`}>
                {gap.delta > 0 ? "+" : "−"}
                {Math.abs(gap.delta)}
              </span>
            ) : null}
          </span>
        </div>

        <div className="prof-actions">
          {canEdit ? (
            <>
              <button className="btn sm" type="button" disabled={busy || c.status === "shortlisted"} onClick={() => act({ type: "shortlist" }, "Shortlisted.")}>
                Shortlist
              </button>
              <button className="btn2 sm" type="button" disabled={busy || c.status === "rejected"} onClick={() => act({ type: "reject" }, "Rejected.")}>
                Reject
              </button>
              <label className="label" htmlFor="ovr">
                Change pick
              </label>
              <select
                id="ovr"
                disabled={busy}
                value={r.override?.pick ?? ""}
                onChange={(e) => {
                  const v = e.target.value as PickValue | "";
                  void act(
                    { type: "override", new_value: { pick: v || null }, ...(note.trim() ? { note: note.trim() } : {}) },
                    v ? `Pick changed to ${PICK_LABEL[v]}. It stays even if the call is scored again.` : "Back to the scored pick.",
                  ).then((ok) => ok && setNote(""));
                }}
              >
                <option value="">As scored{r.scored_pick ? ` (${PICK_LABEL[r.scored_pick]})` : ""}</option>
                {PICKS.map((k) => (
                  <option key={k} value={k}>
                    {PICK_LABEL[k]}
                  </option>
                ))}
              </select>
              {decided ? (
                <>
                  <span className={`decision ${decided === "shortlisted" ? "ok" : "no"}`}>{decided === "shortlisted" ? "Shortlisted" : "Rejected"}</span>
                  <button
                    className="linkbtn"
                    type="button"
                    disabled={busy}
                    onClick={() => act({ type: decided === "shortlisted" ? "shortlist" : "reject", new_value: { undo: true } }, "Decision undone.")}
                  >
                    Undo
                  </button>
                </>
              ) : null}
            </>
          ) : (
            <span className="label">{meIsHm ? "As hiring manager you can add notes. Recruiters make the shortlist." : "You can add notes."}</span>
          )}
        </div>
        <form
          className="prof-note"
          onSubmit={(e) => {
            e.preventDefault();
            if (!note.trim()) return;
            void act({ type: "note", note: note.trim() }, "Note added.").then((ok) => ok && setNote(""));
          }}
        >
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={canEdit ? "Add a note for the team (also saved with a pick change)" : "Add a note for the team"}
            aria-label="Note"
            maxLength={2000}
            rows={1}
          />
          <button className="btn2 sm" type="submit" disabled={busy || !note.trim()}>
            Add note
          </button>
        </form>
        {msg ? (
          <p className={`prof-msg ${msg.ok ? "ok" : "bad"}`} role="status">
            {msg.text}
          </p>
        ) : null}
      </div>

      <div className="prof-grid">
        <div>
          <section className="card sec">
            <h2>
              Qualities <span className="label" style={{ fontWeight: 400 }}>· 1 to 5, with what they said</span>
            </h2>
            {r.scored ? (
              p.qualities.map((k) => {
                const qq = r.qualities[k.key];
                const has = typeof qq?.score === "number";
                const w = weights[k.key] ?? 0;
                return (
                  <div key={k.key} className={has ? "q" : "q unscored"}>
                    <div className="qtop">
                      <span className="qname">{k.name}</span>
                      <span className="qw">{w > 0 ? `weight ${Math.round((w / totalW) * 100)}%` : "not weighted"}</span>
                      <span className="pips" aria-hidden="true">
                        {[1, 2, 3, 4, 5].map((i) => (
                          <i key={i} className={has && i <= (qq?.score ?? 0) ? "on" : undefined} />
                        ))}
                      </span>
                      <span className="qscore">{has ? `${qq?.score}/5` : "n/a"}</span>
                    </div>
                    <div className="qreason">{qq?.reason || "Not enough evidence in the call to score this."}</div>
                    {(qq?.quotes ?? []).slice(0, 2).map((t, i) => {
                      const s = tsSeconds(t.ts);
                      return canSeek ? (
                        <button key={i} type="button" className="quote" onClick={() => playQuote(t.text, t.ts)} title={s !== null && p.recording_signed_url ? "Play this moment" : "Find in transcript"}>
                          “{t.text}”{s !== null && p.recording_signed_url ? <span className="ts">{mmss(s)}</span> : null}
                        </button>
                      ) : (
                        <blockquote key={i} className="quote">
                          “{t.text}”
                        </blockquote>
                      );
                    })}
                  </div>
                );
              })
            ) : (
              <p className="hint">No scored call yet. Qualities, quotes and reasons appear here when their call ends.</p>
            )}
          </section>

          <section className="card sec">
            <h2>Must-haves</h2>
            <MustHaves p={p} />
          </section>

          <section className="card sec">
            <h2>Flags</h2>
            <FlagList p={p} />
          </section>
        </div>

        <div>
          <section className="card sec">
            <h2>Summary</h2>
            {r.summary ? <p className="lede">{r.summary}</p> : <p className="hint">The summary appears after the call is scored.</p>}
            {c.resume_note ? (
              <p className="label" style={{ marginTop: 12 }}>
                Resume note: {c.resume_note}
              </p>
            ) : null}
          </section>

          <section className="card sec audio">
            <h2>Recording and transcript</h2>
            {p.recording_signed_url ? (
              <audio ref={audio} controls preload="none" src={p.recording_signed_url}>
                Your browser cannot play this recording.
              </audio>
            ) : (
              <p className="hint">{p.transcript ? "No recording for this call." : "No recording yet."}</p>
            )}
            {lines.length ? (
              <div className="tx" ref={txRef} style={{ marginTop: 14 }} tabIndex={0} aria-label="Transcript">
                {lines.map((l, i) => (
                  <p key={i} data-line={i} className={hit === i ? "hit" : undefined}>
                    {l.who ? <span className={l.who === "a" ? "who-a" : "who-c"}>{l.who === "a" ? "Aditi" : c.name.split(/\s+/)[0]}</span> : null}
                    {l.text}
                  </p>
                ))}
              </div>
            ) : (
              <p className="hint" style={{ marginTop: 8 }}>
                The transcript appears when a call completes.
              </p>
            )}
          </section>

          <section className="card sec">
            <h2>Call history</h2>
            {p.calls.length ? (
              <div className="tablewrap">
                <table className="hist">
                  <thead>
                    <tr>
                      <th>Try</th>
                      <th>When</th>
                      <th>Result</th>
                      <th>Length</th>
                    </tr>
                  </thead>
                  <tbody>
                    {p.calls.map((x) => {
                      const t = callText({ state: x.state, outcome: x.outcome, durationS: x.duration_s, attempt: x.attempt });
                      return (
                        <tr key={x.id}>
                          <td>
                            <span className="num">{x.attempt}</span> · {KIND_LABEL[x.kind] ?? x.kind}
                            {x.scheduled ? <span className="held">Booked callback</span> : null}
                          </td>
                          <td>{when(x.started_at ?? (x.state === "queued" ? x.due_at : x.created_at))}</td>
                          <td>
                            {t.text}
                            {x.callback_at ? <span className="held">Callback booked · {when(x.callback_at)}</span> : null}
                          </td>
                          <td className="num">{typeof x.duration_s === "number" && x.duration_s > 0 ? mmss(x.duration_s) : "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="hint">Not called yet.</p>
            )}
          </section>

          <section className="card sec">
            <h2>Team activity</h2>
            {p.actions.length ? (
              <ul className="plain log">
                {p.actions.map((a) => (
                  <li key={a.id}>
                    <span className="log-top">
                      <b>{actionLabel(a, jobTitles)}</b>
                      <span className="label">
                        {a.by_me ? "You" : "Teammate"} · {when(a.at)}
                      </span>
                    </span>
                    {a.note ? <span className="log-note">{a.note}</span> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="hint">No notes or decisions yet. Every shortlist, rejection, pick change and note is kept here.</p>
            )}
          </section>
        </div>
      </div>
    </>
  );
}

function actionLabel(a: Profile["actions"][number], titles: Map<string, string>) {
  const v = (a.new_value && typeof a.new_value === "object" ? a.new_value : {}) as Record<string, unknown>;
  switch (a.type) {
    case "note":
      return "Note";
    case "shortlist":
      return v.undo ? "Shortlist undone" : v.from_job_id ? "Shortlisted from the talent pool" : "Shortlisted";
    case "reject":
      return v.undo ? "Rejection undone" : "Rejected";
    case "override":
      return typeof v.pick === "string" && v.pick in PICK_LABEL ? `Pick changed to ${PICK_LABEL[v.pick as PickValue]}` : "Pick back to as scored";
    case "move_to_job":
      return `Moved to ${titles.get(String(v.target_job_id)) ?? "another job"}'s shortlist`;
    case "recall":
      return "Call again";
    default:
      return a.type;
  }
}

function MustHaves({ p }: { p: Profile }) {
  const res = p.result.must_have_results;
  const seen = new Set(res.map((m) => m.text.toLowerCase()));
  const notAsked = (p.rubric?.mustHaves ?? []).filter((t) => !seen.has(t.toLowerCase()));
  if (!res.length && !notAsked.length) return <p className="hint">No must-haves set for this job.</p>;
  return (
    <ul className="plain">
      {res.map((m, i) => (
        <li key={`r${i}`}>
          <span className={`mh${m.met === true ? "" : m.met === false ? " no" : " na"}`}>{m.met === true ? "Met" : m.met === false ? "Not met" : "Unclear"}</span>
          <span>
            {m.text}
            {m.quote ? <span className="mm-line">“{m.quote}”</span> : null}
          </span>
        </li>
      ))}
      {notAsked.map((t) => (
        <li key={`n${t}`}>
          <span className="mh na">{p.result.scored ? "Not asked" : "Pending"}</span>
          <span>{t}</span>
        </li>
      ))}
    </ul>
  );
}

function FlagList({ p }: { p: Profile }) {
  const f = p.result.flags;
  const chips = [
    f.otherRole ? <span key="r" className="chip f-role">Fits another role: {f.otherRole}</span> : null,
    f.cultureStandout ? <span key="c" className="chip f-culture">Culture standout</span> : null,
    f.wantsInternship ? <span key="i" className="chip f-intern">Wants internship</span> : null,
    f.resumeMismatch ? <span key="m" className="chip warn">Resume mismatch</span> : null,
    f.hrReview ? <span key="h" className="chip">HR to review</span> : null,
  ].filter(Boolean);
  if (!p.result.scored) return <p className="hint">Flags appear after the call is scored.</p>;
  return (
    <>
      {chips.length ? <div className="chips">{chips}</div> : <p className="label">No flags.</p>}
      {p.result.short_exit ? <p className="qreason" style={{ marginTop: 10 }}>The call ended early, so the pick is capped at Maybe.</p> : null}
      {f.hrReview ? <p className="qreason" style={{ marginTop: 10 }}>HR review: {f.hrReview}</p> : null}
      {p.result.mismatches.length ? (
        <ul className="plain" style={{ marginTop: 10 }}>
          {p.result.mismatches.map((m, i) => (
            <li key={i}>
              <span className="mh no">Mismatch</span>
              <span>
                {m.claim_quote ? <span className="mm-claim">On the call: “{m.claim_quote}”</span> : null}
                {m.resume_line ? <span className="mm-line">Resume says: {m.resume_line}</span> : null}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}
