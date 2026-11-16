"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { parseCandidateCsv } from "@/lib/ingest/csv";
import type { CallOutcome, CallState } from "@/lib/types";
import { READABLE_ACCEPT, extractText, tidy } from "@/components/jobs/extract-text";
import { fileKey, matchResumes } from "./resume-match";

type Progress = {
  batch: { id: string; status: string };
  total: number;
  queued: number;
  in_flight: number;
  done: number;
  callbacks: number;
  outcomes: Record<string, number>;
};
type Resume = { name: string; status: "reading" | "ok" | "error"; text: string; error?: string };
type ImportOut = { candidate_ids: string[]; duplicates: number; invalid: { row: number; reason: string }[]; resumes_read?: number };

const MAX_RESUME_CHARS = 20_000;
/** Rows carrying resume text go up in small groups: each import reads its resumes before answering. */
const RESUME_CHUNK = 20;
type BRow = { candidate_id: string; name: string; tail: string; status: string; state: CallState; outcome: CallOutcome | null; attempt: number };

const SAMPLE =
  "name,phone,resume_filename,resume_note\nRiya Sharma,+91 98765 43210,riya-sharma.pdf,2 yrs inside sales at an edtech\nArjun Mehta,9876501234,arjun-mehta.docx,Fresher; B.Com; sold college fest sponsorships\n";
const SAMPLE_HREF = `data:text/csv;charset=utf-8,${encodeURIComponent(SAMPLE)}`;

const OUT_LABEL: Record<CallOutcome, string> = {
  completed: "Call done",
  short_exit: "Short exit",
  no_answer: "No answer",
  busy: "Line busy",
  voicemail: "Voicemail",
  wrong_person: "Wrong person",
  declined: "Declined",
  rescheduled: "Callback booked",
  dropped: "Dropped",
  failed: "Failed",
};

function rowChip(r: BRow): { cls: string; text: string } {
  if (["scored", "shortlisted", "rejected"].includes(r.status)) return { cls: "ok", text: "Ranked" };
  if (r.state === "queued") return { cls: "", text: r.attempt > 1 ? "Retry queued" : "Waiting" };
  if (r.state === "dialing") return { cls: "run", text: "Dialling" };
  if (r.state === "in_call") return { cls: "run", text: "On call" };
  if (r.outcome === "completed" || r.outcome === "short_exit") return { cls: "run", text: "Scoring" };
  if (r.outcome === "rescheduled") return { cls: "end", text: OUT_LABEL.rescheduled };
  return { cls: "bad", text: r.outcome ? OUT_LABEL[r.outcome] : "Ended" };
}

async function errorOf(res: Response, fallback: string) {
  const d = (await res.json().catch(() => null)) as { error?: string } | null;
  return d?.error || fallback;
}

export function BatchPanel({ job, canCall, initialBatchId }: { job: { id: string; title: string }; canCall: boolean; initialBatchId: string | null }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");
  const [batchId, setBatchId] = useState<string | null>(initialBatchId);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [rows, setRows] = useState<BRow[]>([]);
  const [resumes, setResumes] = useState<Record<string, Resume>>({});
  const [manual, setManual] = useState<Record<string, string>>({});
  const [dragOver, setDragOver] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);
  const [dropCallbacks, setDropCallbacks] = useState(false);

  const parsed = useMemo(() => (text.trim() ? parseCandidateCsv(text) : []), [text]);
  const usable = useMemo(() => parsed.filter((r) => r.name && r.phone), [parsed]);
  const skipped = parsed.length - usable.length;

  // Resume ↔ row: the CSV's file-name column, else the applicant's name in the file name; manual picks win.
  const auto = useMemo(
    () => matchResumes(usable.map((r) => ({ key: String(r.row), name: r.name, resume_filename: r.resume_filename })), Object.values(resumes).map((f) => f.name)),
    [usable, resumes],
  );
  const resumeFor = (rowKey: string): Resume | null => {
    const picked = manual[rowKey];
    const name = picked === undefined ? auto.get(rowKey) : picked;
    return name ? (resumes[fileKey(name)] ?? null) : null;
  };
  const matchedKeys = new Set(usable.map((r) => resumeFor(String(r.row))).filter((f): f is Resume => Boolean(f)).map((f) => fileKey(f.name)));
  const resumeList = Object.values(resumes);
  const unmatched = resumeList.filter((f) => !matchedKeys.has(fileKey(f.name)));
  const reading = resumeList.some((f) => f.status === "reading");
  const withResume = usable.filter((r) => resumeFor(String(r.row))?.status === "ok").length;

  async function addResumes(files: File[], forRow?: string) {
    const list = files.filter((f) => f.name);
    if (!list.length) return;
    setResumes((m) => {
      const next = { ...m };
      for (const f of list) next[fileKey(f.name)] = { name: f.name, status: "reading", text: "" };
      return next;
    });
    if (forRow) setManual((m) => ({ ...m, [forRow]: list[0].name }));
    // a few at a time: PDF reading is heavy on low-end laptops
    const queue = [...list];
    const worker = async () => {
      for (let f = queue.shift(); f; f = queue.shift()) {
        const file = f;
        let next: Resume;
        try {
          const t = tidy(await extractText(file)).slice(0, MAX_RESUME_CHARS);
          next = t ? { name: file.name, status: "ok", text: t } : { name: file.name, status: "error", text: "", error: "No text found (a scanned image?)" };
        } catch (e) {
          next = { name: file.name, status: "error", text: "", error: e instanceof Error ? e.message : "Could not read this file" };
        }
        setResumes((m) => (m[fileKey(file.name)] ? { ...m, [fileKey(file.name)]: next } : m));
      }
    };
    await Promise.all([worker(), worker(), worker()]);
  }

  function removeResume(name: string) {
    setResumes((m) => {
      const next = { ...m };
      delete next[fileKey(name)];
      return next;
    });
    setManual((m) => Object.fromEntries(Object.entries(m).filter(([, v]) => fileKey(v) !== fileKey(name))));
  }

  const finished =
    !!progress && (progress.batch.status === "stopped" || progress.batch.status === "done" || (progress.total > 0 && progress.queued + progress.in_flight === 0));

  const load = useCallback(async (id: string) => {
    const supabase = createClient();
    const [res, { data }] = await Promise.all([
      fetch(`/api/batches/${id}`, { cache: "no-store" }),
      supabase
        .from("calls")
        .select("candidate_id, attempt, state, outcome, created_at, candidate:candidates!calls_candidate_id_company_id_fkey(name, phone, status)")
        .eq("batch_id", id)
        .order("created_at", { ascending: true })
        .limit(2000),
    ]);
    if (res.ok) setProgress((await res.json()) as Progress);
    else if (res.status === 404) {
      setErr("That batch is not available any more.");
      setBatchId(null);
      return;
    }
    const latest = new Map<string, BRow>();
    for (const c of data ?? []) {
      // rows arrive oldest → newest; a callback restarts at attempt 1, so the newest row wins
      latest.set(c.candidate_id, {
        candidate_id: c.candidate_id,
        name: c.candidate?.name ?? "Candidate",
        tail: (c.candidate?.phone ?? "").slice(-4),
        status: c.candidate?.status ?? "",
        state: c.state,
        outcome: c.outcome,
        attempt: c.attempt,
      });
    }
    setRows([...latest.values()]);
  }, []);

  // live progress: Realtime nudges + polling as the safety net
  useEffect(() => {
    if (!batchId) return;
    const supabase = createClient();
    let timer: ReturnType<typeof setTimeout> | null = null;
    let poll: ReturnType<typeof setInterval> | null = null;
    const nudge = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void load(batchId), 400);
    };
    const channel = supabase
      .channel(`batch:${batchId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "calls", filter: `batch_id=eq.${batchId}` }, nudge)
      .subscribe();
    nudge();
    poll = setInterval(() => void load(batchId), 5000);
    return () => {
      if (timer) clearTimeout(timer);
      if (poll) clearInterval(poll);
      void supabase.removeChannel(channel);
    };
  }, [batchId, load]);

  function setUrl(id: string | null) {
    const q = new URLSearchParams({ job: job.id });
    if (id) q.set("batch", id);
    router.replace(`/calls?${q.toString()}`, { scroll: false });
  }

  async function start() {
    setErr("");
    setNote("");
    if (!usable.length) return setErr("Add at least one applicant: a name and a mobile number per line.");
    if (!consent) return setErr("Confirm these applicants agreed to be contacted.");
    setBusy(true);
    try {
      const toRow = (r: (typeof usable)[number]) => {
        const resume = resumeFor(String(r.row));
        return {
          name: r.name,
          phone: r.phone,
          ...(r.email ? { email: r.email } : {}),
          ...(r.resume_note ? { resume_note: r.resume_note } : {}),
          ...(resume?.status === "ok" ? { resume_text: resume.text } : {}),
        };
      };
      const all = usable.map(toRow);
      const plain = all.filter((r) => !("resume_text" in r));
      const rich = all.filter((r) => "resume_text" in r);
      const chunks = [...(plain.length ? [plain] : []), ...Array.from({ length: Math.ceil(rich.length / RESUME_CHUNK) }, (_, i) => rich.slice(i * RESUME_CHUNK, (i + 1) * RESUME_CHUNK))];
      const d: ImportOut = { candidate_ids: [], duplicates: 0, invalid: [], resumes_read: 0 };
      let sent = 0;
      for (const chunk of chunks) {
        if (rich.length) setNote(`Adding applicants and reading resumes… ${Math.min(sent, all.length)} of ${all.length}`);
        const imp = await fetch(`/api/jobs/${job.id}/candidates/import`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ rows: chunk, consent_confirmed: true }),
        });
        if (!imp.ok) {
          setNote("");
          return setErr(`${await errorOf(imp, "Could not add these applicants.")}${d.candidate_ids.length ? ` ${d.candidate_ids.length} were added before this; they are in the job, not called yet.` : ""}`);
        }
        const part = (await imp.json()) as ImportOut;
        d.candidate_ids.push(...part.candidate_ids);
        d.duplicates += part.duplicates;
        d.invalid.push(...(part.invalid ?? []));
        d.resumes_read = (d.resumes_read ?? 0) + (part.resumes_read ?? 0);
        sent += chunk.length;
      }
      setNote("");
      const parts = [
        d.duplicates ? `${d.duplicates} already in this job` : "",
        d.invalid?.length ? `${d.invalid.length} with a number that does not look right` : "",
        d.resumes_read ? `${d.resumes_read} resume${d.resumes_read === 1 ? "" : "s"} read` : "",
      ].filter(Boolean);
      if (!d.candidate_ids.length) return setErr(`Nobody new to call${parts.length ? `: ${parts.join(", ")}` : ""}.`);

      const b = await fetch("/api/batches", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ job_id: job.id, candidate_ids: d.candidate_ids }),
      });
      if (!b.ok) {
        const msg = await errorOf(b, "Could not queue the calls.");
        return setErr(b.status === 409 ? "They were added, but none are ready to call. The resume filter may have held them back; check the job’s calling setting." : msg);
      }
      const bd = (await b.json()) as { batch_id: string; queued: number };
      const held = d.candidate_ids.length - bd.queued;
      setNote(
        [`${bd.queued} queued`, ...parts, held > 0 ? `${held} held back by the resume filter` : ""].filter(Boolean).join(" · "),
      );
      setText("");
      setFileName("");
      setResumes({});
      setManual({});
      setConsent(false);
      setProgress(null);
      setRows([]);
      setBatchId(bd.batch_id);
      setUrl(bd.batch_id);
    } catch {
      setErr("Could not reach Pingo. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function stop() {
    if (!batchId) return;
    setBusy(true);
    setErr("");
    try {
      const res = await fetch(`/api/batches/${batchId}/cancel`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cancel_callbacks: dropCallbacks }),
      });
      if (!res.ok) return setErr(await errorOf(res, "Could not stop the batch."));
      const d = (await res.json()) as { cancelled: number; callbacks_kept?: number };
      const kept = d.callbacks_kept ? ` ${d.callbacks_kept} booked callback${d.callbacks_kept === 1 ? "" : "s"} will still happen.` : "";
      setNote(`Stopped. ${d.cancelled} waiting call${d.cancelled === 1 ? "" : "s"} cancelled and nobody will be retried; calls already on the line finish normally.${kept}`);
      setConfirmStop(false);
      setDropCallbacks(false);
      await load(batchId);
    } catch {
      setErr("Could not reach Pingo. Try again.");
    } finally {
      setBusy(false);
    }
  }

  function fresh() {
    setConfirmStop(false);
    setDropCallbacks(false);
    setBatchId(null);
    setProgress(null);
    setRows([]);
    setNote("");
    setErr("");
    setUrl(null);
  }

  const pct = progress && progress.total ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <section className="card bp" aria-labelledby="bp-title">
      <div className="bp-head">
        <div>
          <h2 id="bp-title">Call a batch</h2>
          <p>
            Upload a CSV or paste one applicant per line, and add their resumes if you have them. Pingo reads each resume, calls everyone inside calling hours and
            ranks each one as their call ends.
          </p>
        </div>
        {batchId ? (
          <div className="btnrow">
            {!finished && canCall && !confirmStop ? (
              <button className="btn2" type="button" onClick={() => setConfirmStop(true)} disabled={busy}>
                Stop batch
              </button>
            ) : null}
            <button className="btn2" type="button" onClick={fresh} disabled={busy}>
              New batch
            </button>
          </div>
        ) : null}
      </div>

      {!batchId ? (
        canCall ? (
          <>
            <div className="bp-in">
              <div className="bp-file">
                <label htmlFor="bp-file" className="flabel" style={{ fontWeight: 600, fontSize: 13 }}>
                  CSV file
                </label>
                <input
                  id="bp-file"
                  type="file"
                  accept=".csv,text/csv,.txt"
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    if (f.size > 2 * 1024 * 1024) return setErr("That file is over 2 MB. Split it into smaller batches.");
                    setErr("");
                    setFileName(f.name);
                    setText(await f.text());
                  }}
                />
                <small>Columns: name, phone, and optionally email and resume note.</small>
                <a className="linkbtn" href={SAMPLE_HREF} download="pingo-batch-sample.csv" style={{ alignSelf: "flex-start" }}>
                  Download a sample CSV
                </a>
              </div>
              <div className="f">
                <label htmlFor="bp-paste">Or paste applicants</label>
                <textarea
                  id="bp-paste"
                  rows={5}
                  value={text}
                  onChange={(e) => {
                    setText(e.target.value);
                    setFileName("");
                  }}
                  placeholder={"Name, +91XXXXXXXXXX, short resume note\nRiya Sharma, 98765 43210, 2 yrs inside sales at an edtech"}
                />
              </div>
            </div>
            <div
              className={`bp-res${dragOver ? " over" : ""}`}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                void addResumes([...e.dataTransfer.files]);
              }}
            >
              <div className="bp-res-top">
                <div>
                  <label htmlFor="bp-resumes" className="flabel" style={{ fontWeight: 600, fontSize: 13 }}>
                    Resumes (optional)
                  </label>
                  <small>
                    Drop PDF, Word or text files here, or choose them. Each one is matched to an applicant by the CSV’s file name column, or by the applicant’s name in
                    the file name. The text is read on this computer; the files are not uploaded.
                  </small>
                </div>
                <input id="bp-resumes" type="file" multiple accept={READABLE_ACCEPT} onChange={(e) => void addResumes([...(e.target.files ?? [])]).then(() => (e.target.value = ""))} />
              </div>
              {unmatched.length ? (
                <ul className="bp-res-list" aria-label="Resumes not matched to an applicant">
                  {unmatched.map((f) => (
                    <li key={f.name}>
                      <span>{f.name}</span>
                      <span className={f.status === "error" ? "bp-bad-inline" : "label"}>
                        {f.status === "reading" ? "Reading…" : f.status === "error" ? f.error : "Not matched: pick it in the list below"}
                      </span>
                      <button type="button" className="linkbtn" onClick={() => removeResume(f.name)} aria-label={`Remove ${f.name}`}>
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>

            {usable.length ? (
              <div className="bp-tbl">
                <table>
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Mobile</th>
                      <th>Resume</th>
                    </tr>
                  </thead>
                  <tbody>
                    {usable.map((r) => {
                      const key = String(r.row);
                      const res = resumeFor(key);
                      return (
                        <tr key={key}>
                          <td>{r.name}</td>
                          <td className="num">••{r.phone.replace(/\D/g, "").slice(-4)}</td>
                          <td>
                            <div className="bp-res-cell">
                              {res ? (
                                <span className={`chip ${res.status === "ok" ? "run" : res.status === "error" ? "bad" : ""}`} title={res.error ?? res.name}>
                                  {res.status === "reading" ? "Reading…" : res.status === "error" ? "Could not read" : res.name}
                                </span>
                              ) : null}
                              {resumeList.length ? (
                                <select
                                  aria-label={`Resume for ${r.name}`}
                                  value={res?.name ?? ""}
                                  onChange={(e) => setManual((m) => ({ ...m, [key]: e.target.value }))}
                                >
                                  <option value="">No resume</option>
                                  {resumeList.map((f) => (
                                    <option key={f.name} value={f.name}>
                                      {f.name}
                                    </option>
                                  ))}
                                </select>
                              ) : null}
                              <label className="linkbtn bp-attach">
                                {res ? "Replace" : "Attach"}
                                <input
                                  type="file"
                                  accept={READABLE_ACCEPT}
                                  className="sr-only"
                                  aria-label={`Attach a resume for ${r.name}`}
                                  onChange={(e) => {
                                    const f = e.target.files?.[0];
                                    if (f) void addResumes([f], key);
                                    e.target.value = "";
                                  }}
                                />
                              </label>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : null}

            <div className="bp-foot">
              <label className="chk">
                <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
                <span>These applicants agreed to be contacted about {job.title}</span>
              </label>
              <div className="btnrow">
                <span className="bp-meta">
                  {usable.length ? `${usable.length} applicant${usable.length === 1 ? "" : "s"}${fileName ? ` from ${fileName}` : ""}` : "No applicants yet"}
                  {skipped ? ` · ${skipped} line${skipped === 1 ? "" : "s"} missing a name or number` : ""}
                  {usable.length && resumeList.length ? ` · ${withResume} with a resume` : ""}
                </span>
                <button className="btn" type="button" onClick={start} disabled={busy || reading || !usable.length}>
                  {busy ? "Queuing…" : reading ? "Reading resumes…" : `Call ${usable.length || ""} candidate${usable.length === 1 ? "" : "s"}`.replace("  ", " ")}
                </button>
              </div>
            </div>
          </>
        ) : (
          <p className="hint" style={{ marginTop: 12 }}>
            Only admins and recruiters can start a batch.
          </p>
        )
      ) : (
        <>
          <div className="bp-prog" aria-live="polite">
            <div className="bp-prog-top">
              <span>
                {finished ? (progress?.batch.status === "stopped" ? "Stopped" : "All calls finished") : "Calling"} ·{" "}
                <span className="num">
                  {progress?.done ?? 0}/{progress?.total ?? 0}
                </span>{" "}
                done
              </span>
              <span className="label">
                <span className="num">{progress?.in_flight ?? 0}</span> on the line · <span className="num">{progress?.queued ?? 0}</span> waiting
              </span>
            </div>
            <div className="bar bp-bar" role="progressbar" aria-label="Batch progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
              <i style={{ width: `${pct}%` }} />
            </div>
          </div>
          {confirmStop && !finished ? (
            <div className="bp-stop" role="group" aria-labelledby="bp-stop-title">
              <b id="bp-stop-title">Stop this batch?</b>
              <p>
                {progress?.queued ?? 0} waiting call{(progress?.queued ?? 0) === 1 ? " is" : "s are"} cancelled and nobody in it is retried. Calls already on the line finish
                normally.
                {progress?.callbacks && !dropCallbacks
                  ? ` ${progress.callbacks} booked callback${progress.callbacks === 1 ? "" : "s"} will still happen.`
                  : ""}
              </p>
              {progress?.callbacks ? (
                <label className="chk">
                  <input type="checkbox" checked={dropCallbacks} onChange={(e) => setDropCallbacks(e.target.checked)} />
                  <span>
                    Also cancel the {progress.callbacks} booked callback{progress.callbacks === 1 ? "" : "s"}
                    <small>These candidates asked for a time; cancelling breaks that promise.</small>
                  </span>
                </label>
              ) : null}
              <div className="btnrow">
                <button className="btn sm" type="button" onClick={stop} disabled={busy}>
                  {busy ? "Stopping…" : "Stop batch"}
                </button>
                <button className="btn2 sm" type="button" onClick={() => setConfirmStop(false)} disabled={busy}>
                  Keep calling
                </button>
              </div>
            </div>
          ) : null}
          {rows.length ? (
            <div className="bp-tbl">
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Mobile</th>
                    <th>Try</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const chip = rowChip(r);
                    return (
                      <tr key={r.candidate_id}>
                        <td>
                          <Link href={`/candidates/${r.candidate_id}`} className="linkbtn" style={{ fontSize: 13 }}>
                            {r.name}
                          </Link>
                        </td>
                        <td className="num">••{r.tail}</td>
                        <td className="num">{r.attempt}</td>
                        <td>
                          <span className={`chip ${chip.cls}`}>{chip.text}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="hint" style={{ marginTop: 12 }}>
              {progress && progress.total === 0 ? "No calls left in this batch." : "Loading the batch…"}
            </p>
          )}
        </>
      )}
      {note ? (
        <p className="label" role="status" style={{ marginTop: 12 }}>
          {note}
        </p>
      ) : null}
      {err ? (
        <p className="err" role="alert">
          {err}
        </p>
      ) : null}
    </section>
  );
}
