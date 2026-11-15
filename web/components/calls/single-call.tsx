"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { PICK_LABEL, initials, mmss, type PickValue } from "@/components/candidate-format";
import type { CallOutcome, CallState } from "@/lib/types";
import { SessionError, startWebCall, type WebCallHandle } from "./bolna-web";

export type CallCandidate = { id: string; name: string; phoneTail: string; status: string };

type StageState = "idle" | "connecting" | "oncall" | "scoring" | "done" | "failed";
type Stage = {
  state: StageState;
  label: string;
  sub: string;
  step: number | null;
  result?: { pick: PickValue | null; overall: number | null; summary: string };
};
const IDLE: Stage = { state: "idle", label: "No call in progress", sub: "", step: null };
const STEPS = ["Dialling", "Ringing", "On call", "Scoring", "Ranked"];
const STATE_NAME: Record<StageState, string> = {
  idle: "Call status",
  connecting: "Connecting",
  oncall: "On call",
  scoring: "Scoring",
  done: "Done",
  failed: "Not connected",
};
const LIMIT_S = 600;
/** Wall clock for event handlers (kept out of render). */
const nowMs = () => Date.now();
const SCORE_WAIT_MS = 4 * 60_000;

const FAIL_TEXT: Partial<Record<CallOutcome, [string, string]>> = {
  no_answer: ["No answer", "They did not pick up."],
  busy: ["Line busy", "They were on another call."],
  voicemail: ["Voicemail", "The call went to voicemail."],
  wrong_person: ["Wrong person", "Someone else answered. Check the number."],
  declined: ["Declined", "They did not want to do the screen."],
  rescheduled: ["Callback booked", "They asked to talk later. The callback is in the list on this page."],
  dropped: ["Call dropped", "The line dropped before the screen finished."],
  failed: ["Call failed", "The call could not be connected."],
};

type Detail = {
  pick: PickValue | null;
  overall: number | null;
  score: { created_at: string; summary: string } | null;
  calls: { id: string; state: CallState; outcome: CallOutcome | null; created_at: string; started_at: string | null; due_at: string; callback_at: string | null }[];
};

async function readError(res: Response, fallback: string) {
  const d = (await res.json().catch(() => null)) as { error?: string } | null;
  return d?.error || fallback;
}

export function SingleCall({
  job,
  candidates,
  canCall,
  callingPaused,
  onStageChange,
}: {
  job: { id: string; title: string };
  candidates: CallCandidate[];
  canCall: boolean;
  callingPaused: boolean;
  onStageChange?: (on: boolean) => void;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"pick" | "new">(candidates.length ? "pick" : "new");
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<string>("");
  const [extra, setExtra] = useState<CallCandidate | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("+91 ");
  const [note, setNote] = useState("");
  const [consent, setConsent] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const [stage, setStageRaw] = useState<Stage>(IDLE);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(0);
  const [muted, setMuted] = useState(false);
  const [webOn, setWebOn] = useState(false);
  const [kind, setKind] = useState<"phone" | "web">("phone");
  const web = useRef<WebCallHandle | null>(null);
  const watchStop = useRef<(() => void) | null>(null);
  const [live, setLive] = useState<{ id: string; name: string } | null>(null);

  const all = useMemo(() => (extra && !candidates.some((c) => c.id === extra.id) ? [extra, ...candidates] : candidates), [candidates, extra]);
  const chosen = all.find((c) => c.id === selected) ?? null;
  const needle = filter.trim().toLowerCase();
  const listed = all.filter((c) => !needle || c.name.toLowerCase().includes(needle) || c.phoneTail.includes(needle));

  const setStage = useCallback(
    (s: Stage) => {
      setStageRaw(s);
      onStageChange?.(s.state !== "idle");
    },
    [onStageChange],
  );

  // timer while on a call
  useEffect(() => {
    if (stage.state !== "oncall" || !startedAt) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [stage.state, startedAt]);
  const elapsed = startedAt && stage.state === "oncall" ? Math.max(0, ((now || startedAt) - startedAt) / 1000) : null;

  useEffect(
    () => () => {
      watchStop.current?.();
      web.current?.stop();
    },
    [],
  );

  /** Follows one candidate's call + score: Realtime nudges, polling as the safety net. */
  const watch = useCallback(
    (candidateId: string, since: number, kind: "phone" | "web") => {
      watchStop.current?.();
      const supabase = createClient();
      let stopped = false;
      let timer: ReturnType<typeof setTimeout> | null = null;
      const sinceIso = new Date(since - 30_000).toISOString();
      const scoringSince = { t: kind === "web" ? Date.now() : 0 };

      const apply = (d: Detail) => {
        const fresh = d.score && d.score.created_at >= sinceIso;
        if (fresh) {
          setStage({ state: "done", label: "Ranked", sub: "Scored on the rubric and added to the ranking.", step: 5, result: { pick: d.pick, overall: d.overall, summary: d.score?.summary ?? "" } });
          stop();
          return;
        }
        const recent = d.calls.filter((c) => c.created_at >= sinceIso);
        const latest = recent[recent.length - 1];
        if (kind === "web" || !latest) {
          if (kind === "web" && scoringSince.t && Date.now() - scoringSince.t > SCORE_WAIT_MS) {
            setStage({ state: "done", label: "Call ended", sub: "Scoring is taking longer than usual. The result will appear on their profile.", step: 3 });
            stop();
          }
          return;
        }
        if (latest.state === "queued") {
          const due = Date.parse(latest.due_at);
          const later = Number.isFinite(due) && due - Date.now() > 90_000;
          setStage({
            state: "connecting",
            label: later ? "Queued for later" : "Queued…",
            sub: later ? "Outside calling hours or waiting for a slot. It dials automatically." : "Waiting for a free line.",
            step: 0,
          });
        } else if (latest.state === "dialing") {
          setStage({ state: "connecting", label: "Dialling…", sub: "Placing the call.", step: 1 });
        } else if (latest.state === "in_call") {
          setStartedAt((s) => s ?? (latest.started_at ? Date.parse(latest.started_at) : Date.now()));
          setStage({ state: "oncall", label: "On call", sub: "The screen is under way. It usually takes 6 to 10 minutes.", step: 2 });
        } else if (latest.outcome === "completed" || latest.outcome === "short_exit") {
          if (!scoringSince.t) scoringSince.t = Date.now();
          if (Date.now() - scoringSince.t > SCORE_WAIT_MS) {
            setStage({ state: "done", label: "Call ended", sub: "Scoring is taking longer than usual. The result will appear on their profile.", step: 3 });
            stop();
          } else setStage({ state: "scoring", label: "Scoring…", sub: "Call ended. Reading the transcript and scoring.", step: 3 });
        } else if (latest.state === "finished") {
          const [label, sub] = (latest.outcome && FAIL_TEXT[latest.outcome]) || ["Call ended", "The call did not complete."];
          setStage({ state: "failed", label, sub, step: null });
          stop();
        }
      };

      const tick = async () => {
        if (stopped) return;
        try {
          const res = await fetch(`/api/candidates/${candidateId}`, { cache: "no-store" });
          if (res.ok && !stopped) apply((await res.json()) as Detail);
        } catch {
          /* transient; next tick retries */
        }
        if (!stopped) {
          if (timer) clearTimeout(timer);
          timer = setTimeout(tick, 4000);
        }
      };
      const nudge = () => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(tick, 300);
      };
      const channel = supabase
        .channel(`call-watch:${candidateId}:${since}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "calls", filter: `candidate_id=eq.${candidateId}` }, nudge)
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "scores", filter: `candidate_id=eq.${candidateId}` }, nudge)
        .subscribe();

      function stop() {
        stopped = true;
        if (timer) clearTimeout(timer);
        void supabase.removeChannel(channel);
        if (watchStop.current === stop) watchStop.current = null;
        router.refresh();
      }
      watchStop.current = stop;
      if (kind === "phone") void tick();
      return { tick, stop };
    },
    [router, setStage],
  );

  async function ensureCandidate(): Promise<CallCandidate | null> {
    setErr("");
    if (mode === "pick") {
      if (!chosen) {
        setErr("Pick a candidate from the list first.");
        return null;
      }
      return chosen;
    }
    if (!name.trim()) {
      setErr("Enter the candidate’s name.");
      return null;
    }
    if (phone.replace(/\D/g, "").length < 10) {
      setErr("Enter a mobile number, for example +91 98765 43210.");
      return null;
    }
    if (!consent) {
      setErr("Confirm they agreed to be contacted for this job.");
      return null;
    }
    const res = await fetch(`/api/jobs/${job.id}/candidates/import`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        rows: [{ name: name.trim(), phone: phone.trim(), ...(note.trim() ? { resume_note: note.trim() } : {}) }],
        consent_confirmed: true,
      }),
    });
    if (!res.ok) {
      setErr(await readError(res, "Could not add the candidate."));
      return null;
    }
    const d = (await res.json()) as { candidate_ids?: string[]; duplicates?: number; invalid?: { reason: string }[] };
    if (d.invalid?.length) {
      setErr(`That number does not look right: ${d.invalid[0].reason}.`);
      return null;
    }
    const id = d.candidate_ids?.[0];
    if (!id) {
      setErr("They are already in this job. Pick them from the list instead.");
      setMode("pick");
      setFilter(name.trim());
      return null;
    }
    const c = { id, name: name.trim(), phoneTail: phone.replace(/\D/g, "").slice(-4), status: "imported" };
    setExtra(c);
    setSelected(id);
    setMode("pick");
    setName("");
    setPhone("+91 ");
    setNote("");
    setConsent(false);
    router.refresh();
    return c;
  }

  async function callPhone() {
    if (busy) return;
    setBusy(true);
    try {
      const c = await ensureCandidate();
      if (!c) return;
      setLive({ id: c.id, name: c.name });
      setKind("phone");
      setStartedAt(null);
      const since = nowMs();
      setStage({ state: "connecting", label: "Queuing…", sub: `Asking Pingo to phone ${c.name}.`, step: 0 });
      const res = await fetch("/api/calls/phone", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ candidate_id: c.id }),
      });
      if (!res.ok) {
        const msg = res.status === 404 ? "Phone calling is not set up on this server yet." : await readError(res, "Could not queue the call.");
        setStage({ state: "failed", label: "Could not start the call", sub: msg, step: null });
        return;
      }
      watch(c.id, since, "phone");
    } catch {
      setStage({ state: "failed", label: "Could not start the call", sub: "Could not reach Pingo. Check your connection and try again.", step: null });
    } finally {
      setBusy(false);
    }
  }

  async function talkInBrowser() {
    if (busy) return;
    setBusy(true);
    try {
      const c = await ensureCandidate();
      if (!c) return;
      setLive({ id: c.id, name: c.name });
      setKind("web");
      setStartedAt(null);
      setMuted(false);
      const since = nowMs();
      setStage({ state: "connecting", label: "Getting ready…", sub: "Loading the in-browser call. Allow the microphone when asked.", step: 0 });
      web.current = await startWebCall(c.id, {
        state: (s) => {
          if (s === "oncall") {
            setStartedAt((t) => t ?? Date.now());
            setWebOn(true);
            setStage({ state: "oncall", label: "On call", sub: "Speak normally. The screen usually takes 6 to 10 minutes.", step: 2 });
          } else if (s === "ending") {
            setStage({ state: "scoring", label: "Ending call…", sub: "Wrapping up.", step: 3 });
          } else {
            setStage({ state: "connecting", label: "Connecting…", sub: "Allow the microphone when asked.", step: 1 });
          }
        },
        error: (msg) => setErr(msg),
        end: (runId, reason) => {
          web.current = null;
          setWebOn(false);
          if (!runId) {
            setStage({ state: "failed", label: "Call ended", sub: `We could not find this call to score it${reason ? ` (${reason})` : ""}. Nothing was added to the ranking.`, step: null });
            return;
          }
          setStage({ state: "scoring", label: "Scoring…", sub: "Call ended. Reading the transcript and scoring.", step: 3 });
          const w = watch(c.id, since, "web");
          setTimeout(() => void w.tick(), 2000);
        },
      });
    } catch (e) {
      web.current?.stop();
      web.current = null;
      setWebOn(false);
      let msg = e instanceof Error && e.message ? e.message : "Could not start the in-browser call.";
      if (e instanceof Error && /permission|notallowed|denied/i.test(`${e.name} ${e.message}`)) msg = "Microphone access was blocked. Allow the microphone for this page and try again.";
      if (e instanceof SessionError && e.status === 404 && !/candidate/i.test(e.message)) msg = "Browser calling is not set up on this server yet.";
      else if (!(e instanceof SessionError) && /mint|session|fetch/i.test(msg)) msg = "Could not start the in-browser call on this server. Try again in a moment.";
      setStage({ state: "failed", label: "Could not start the call", sub: msg, step: null });
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    watchStop.current?.();
    web.current?.stop();
    web.current = null;
    setWebOn(false);
    setStartedAt(null);
    setErr("");
    setStage(IDLE);
  }

  const stageOn = stage.state !== "idle";

  return (
    <>
      {!stageOn ? (
        <div className="card sec callform">
          <h2>Call one candidate</h2>
          <div className="seg cf-mode" role="group" aria-label="Who to call">
            <button type="button" aria-pressed={mode === "pick"} onClick={() => setMode("pick")} disabled={!all.length}>
              From this job
            </button>
            <button type="button" aria-pressed={mode === "new"} onClick={() => setMode("new")} disabled={!canCall}>
              Someone new
            </button>
          </div>

          {mode === "pick" ? (
            <div className="cf-pick">
              <input type="search" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search by name or last 4 digits" aria-label="Search candidates" />
              <select size={6} value={selected} onChange={(e) => setSelected(e.target.value)} aria-label={`Candidates for ${job.title}`}>
                {listed.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} · ••{c.phoneTail}
                    {c.status === "scored" ? " · scored" : c.status === "queued" ? " · queued" : c.status === "calling" ? " · on a call" : ""}
                  </option>
                ))}
              </select>
              {!listed.length ? <span className="label">{all.length ? "Nobody matches that search." : "No candidates in this job yet. Add someone new."}</span> : null}
            </div>
          ) : (
            <div className="cf-grid">
              <div className="f">
                <label htmlFor="nc-name">Candidate name</label>
                <input id="nc-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
              </div>
              <div className="f">
                <label htmlFor="nc-phone">Mobile</label>
                <input id="nc-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91 98765 43210" autoComplete="off" />
              </div>
              <div className="f full">
                <label htmlFor="nc-note">Short resume note (optional)</label>
                <textarea id="nc-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. 2 years inside sales at an edtech, B.Com, no SaaS experience" rows={2} />
              </div>
              <label className="chk full">
                <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
                <span>
                  They agreed to be contacted about {job.title}
                  <small>Pingo records consent with the candidate before any call.</small>
                </span>
              </label>
            </div>
          )}

          {chosen && mode === "pick" ? (
            <div className="chosen">
              <div className="who">
                <span className="av" aria-hidden="true">
                  {initials(chosen.name)}
                </span>
                <div>
                  <div className="nm">{chosen.name}</div>
                  <div className="src">Mobile ending {chosen.phoneTail}</div>
                </div>
              </div>
              <Link className="linkbtn" href={`/candidates/${chosen.id}`}>
                Profile
              </Link>
            </div>
          ) : null}

          <div className="btnrow" style={{ marginTop: 16 }}>
            <button className="btn" type="button" onClick={talkInBrowser} disabled={busy || !canCall}>
              Talk in browser
            </button>
            <button className="btn2" type="button" onClick={callPhone} disabled={busy || !canCall}>
              Call phone
            </button>
          </div>
          {err ? (
            <p className="err" role="alert">
              {err}
            </p>
          ) : null}
          <p className={`callnote${callingPaused ? " warn" : ""}`}>
            {!canCall
              ? "Only admins and recruiters can start calls."
              : callingPaused
                ? "Phone calls are paused on the server, so a phone call waits in the queue. Talking in the browser works now and uses your microphone."
                : "Talking in the browser uses your microphone, so allow it when asked. A phone call dials inside the job’s calling hours."}
          </p>
        </div>
      ) : null}

      {stageOn ? (
        <div className="stage" data-state={stage.state} data-muted={muted ? "true" : undefined} aria-live="polite">
          <div className="stage-in">
            <div className="visual" aria-hidden="true">
              <span className="ring" />
              <span className="ring r2" />
              <span className="ring r3" />
              <span className="pulse" />
              <div className="wave">
                <i />
                <i />
                <i />
                <i />
                <i />
                <i />
                <i />
              </div>
            </div>
            <div>
              <div className="st-label">{STATE_NAME[stage.state]}</div>
              <div className="st-big">{stage.label}</div>
              <div className="st-sub">{stage.sub}</div>
              {startedAt && (stage.state === "oncall" || elapsed !== null) ? (
                <>
                  <div className="elapsed">
                    <span className="num">{mmss(elapsed ?? 0)}</span>
                    <span className="label">with {live?.name}</span>
                  </div>
                  <div className="limit">
                    <div className="bar" role="meter" aria-label="Time used of the 10-minute limit" aria-valuemin={0} aria-valuemax={LIMIT_S} aria-valuenow={Math.round(elapsed ?? 0)}>
                      <i style={{ width: `${Math.min(100, ((elapsed ?? 0) / LIMIT_S) * 100)}%` }} />
                    </div>
                    <div className="label">
                      <span>Time used of the 10-minute limit</span>
                      <span className="num">{mmss(Math.max(0, LIMIT_S - (elapsed ?? 0)))} left</span>
                    </div>
                  </div>
                </>
              ) : null}
              {stage.step !== null ? (
                <ol className="steps" aria-label="Progress">
                  {STEPS.map((s, i) => (
                    <li key={s} className={i < (stage.step ?? 0) ? "done" : i === stage.step ? "now" : undefined} aria-current={i === stage.step ? "step" : undefined}>
                      {i + 1}. {s}
                    </li>
                  ))}
                </ol>
              ) : null}
              {webOn ? (
                <div className="btnrow webctl">
                  <span className={`chip accent micchip${muted ? " muted" : ""}`}>{muted ? "Muted" : "Mic on"}</span>
                  <button className="btn2" type="button" onClick={() => setMuted(web.current?.toggleMute() ?? false)}>
                    {muted ? "Unmute" : "Mute"}
                  </button>
                  <button className="btn hangbtn" type="button" onClick={() => web.current?.stop()}>
                    Hang up
                  </button>
                </div>
              ) : null}
              {err && stage.state !== "failed" ? (
                <p className="err" role="alert">
                  {err}
                </p>
              ) : null}
              {stage.result && live ? (
                <div className="result">
                  <div className="result-top">
                    {stage.result.pick ? <span className={`pick ${stage.result.pick}`}>{PICK_LABEL[stage.result.pick]}</span> : null}
                    {typeof stage.result.overall === "number" ? <span className="num">{stage.result.overall}</span> : null}
                    <b>{live.name}</b>
                  </div>
                  <p>{stage.result.summary || "Scored and added to the ranking."}</p>
                  <div className="btnrow">
                    <Link className="btn sm" href={`/candidates/${live.id}`}>
                      Open profile
                    </Link>
                    <Link className="btn2 sm" href={`/candidates?job=${job.id}`}>
                      See the ranking
                    </Link>
                  </div>
                </div>
              ) : null}
              {stage.state === "done" || stage.state === "failed" ? (
                <div className="btnrow" style={{ marginTop: 18 }}>
                  <button className="btn2" type="button" onClick={reset}>
                    Start another call
                  </button>
                  {!stage.result && live ? (
                    <Link className="linkbtn" href={`/candidates/${live.id}`}>
                      Open {live.name}’s profile
                    </Link>
                  ) : null}
                </div>
              ) : stage.state === "connecting" || stage.state === "scoring" ? (
                <div className="btnrow" style={{ marginTop: 18 }}>
                  <button className="linkbtn" type="button" onClick={reset}>
                    {stage.state === "scoring"
                      ? "Leave it to finish in the background"
                      : kind === "web"
                        ? "Cancel"
                        : "Stop watching (the call stays queued)"}
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
