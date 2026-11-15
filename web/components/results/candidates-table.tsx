"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { RUBRIC_PRESETS } from "@/lib/types";
import { PICK_LABEL, callText, initials, isHiddenFit, sourceLabel, type PickValue } from "@/components/candidate-format";
import { IconSearch } from "@/components/icons";
import { rerank, resumeGap, resumeWouldDrop, type RankRow } from "./model";

type Filter = "all" | PickValue | "hidden" | "shortlisted" | "rejected" | "unscored";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "amazing", label: "Amazing" },
  { id: "good", label: "Good" },
  { id: "maybe", label: "Maybe" },
  { id: "no", label: "No" },
  { id: "hidden", label: "Hidden fits" },
  { id: "shortlisted", label: "Shortlisted" },
  { id: "rejected", label: "Rejected" },
  { id: "unscored", label: "Not scored" },
];

const STATUS_TEXT: Record<string, string> = {
  imported: "Not called yet",
  ats_filtered: "ATS filtered",
  queued: "Queued",
  calling: "On a call",
  scored: "Not enough evidence",
  shortlisted: "Not scored",
  rejected: "Not scored",
};

export type CandidatesTableProps = {
  job: { id: string; title: string };
  jobs: { id: string; title: string; status: string }[];
  rubric: { version: number; weights: Record<string, number> } | null;
  qualities: { key: string; name: string }[];
  rows: RankRow[];
  canExport: boolean;
};

export function CandidatesTable({ job, jobs, rubric, qualities, rows, canExport }: CandidatesTableProps) {
  const router = useRouter();
  const [preset, setPreset] = useState<string>(rubric ? "saved" : "balanced");
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");

  const weights = useMemo<Record<string, number>>(() => {
    if (preset === "saved" && rubric) return rubric.weights;
    const p = RUBRIC_PRESETS.find((x) => x.id === preset) ?? RUBRIC_PRESETS[0];
    return p.weights as Record<string, number>;
  }, [preset, rubric]);

  const ranked = useMemo(() => (preset === "saved" ? rows : rerank(rows, weights)), [rows, weights, preset]);

  const counts = useMemo(() => {
    const n: Record<Filter, number> = { all: ranked.length, amazing: 0, good: 0, maybe: 0, no: 0, hidden: 0, shortlisted: 0, rejected: 0, unscored: 0 };
    for (const r of ranked) {
      if (r.status === "shortlisted") n.shortlisted++;
      if (r.status === "rejected") n.rejected++;
      if (r.status === "ats_filtered") continue;
      if (r.pick) n[r.pick]++;
      else n.unscored++;
      if (isHiddenFit(r.flags)) n.hidden++;
    }
    return n;
  }, [ranked]);

  const needle = q.trim().toLowerCase();
  const shown = ranked.filter((r) => {
    if (needle && !`${r.candidate.name} ${r.summary} ${sourceLabel(r.candidate.source)}`.toLowerCase().includes(needle)) return false;
    switch (filter) {
      case "all":
        return true;
      case "shortlisted":
      case "rejected":
        return r.status === filter;
      case "hidden":
        return r.status !== "ats_filtered" && isHiddenFit(r.flags);
      case "unscored":
        return r.status !== "ats_filtered" && !r.pick;
      default:
        return r.status !== "ats_filtered" && r.pick === filter;
    }
  });

  const totalW = Object.values(weights).reduce((a, b) => a + (b > 0 ? b : 0), 0) || 1;
  const weightText = qualities
    .filter((x) => (weights[x.key] ?? 0) > 0)
    .sort((a, b) => (weights[b.key] ?? 0) - (weights[a.key] ?? 0))
    .map((x) => ({ name: x.name, pct: Math.round(((weights[x.key] ?? 0) / totalW) * 100) }));

  const exportHref = `/api/jobs/${job.id}/export${preset !== "saved" ? `?preset=${encodeURIComponent(preset)}` : ""}`;

  return (
    <>
      <div className="phead">
        <div>
          <div className="crumb">
            <Link href="/jobs">Jobs</Link> / {job.title}
          </div>
          <h1>Candidates</h1>
          {weightText.length ? (
            <p className="rs-weights">
              Ranked on{" "}
              {weightText.map((w, i) => (
                <span key={w.name}>
                  {i ? " · " : ""}
                  {w.name} <b>{w.pct}%</b>
                </span>
              ))}
            </p>
          ) : null}
        </div>
        <div className="actions">
          {jobs.length > 1 ? (
            <label className="rs-jobpick">
              Job
              <select value={job.id} onChange={(e) => router.push(`/candidates?job=${e.target.value}`)} aria-label="Show candidates for job">
                {jobs.map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.title}
                    {j.status === "closed" ? " (closed)" : ""}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label className="rubric">
            Hiring for:
            <select value={preset} onChange={(e) => setPreset(e.target.value)} aria-label="Rank by rubric">
              {rubric ? <option value="saved">Saved rubric (v{rubric.version})</option> : null}
              {RUBRIC_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          {canExport ? (
            <a className="btn2 sm" href={exportHref} download>
              Export CSV
            </a>
          ) : null}
        </div>
      </div>

      <div className="card tcard">
        <div className="rs-toolbar">
          <div className="filters" role="group" aria-label="Filter candidates">
            {FILTERS.map((f) => (
              <button key={f.id} type="button" className="fbtn" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
                {f.label}
                <span className="num">{counts[f.id]}</span>
              </button>
            ))}
          </div>
          <div className="search">
            <IconSearch className="i" />
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or summary" aria-label="Search candidates" />
          </div>
        </div>
        <div className="tablewrap">
          <table className="dtable">
            <thead>
              <tr>
                <th>Candidate</th>
                <th>Pick</th>
                <th className="col-score">Score</th>
                <th className="col-call col-gap">Resume vs call</th>
                <th className="col-why">Summary</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {shown.length ? (
                shown.map((r) => <Row key={r.candidate.id} r={r} />)
              ) : (
                <tr>
                  <td colSpan={6} className="empty">
                    {rows.length ? (
                      "Nobody matches. Clear the search or pick another filter."
                    ) : (
                      <>
                        <b>No candidates in this job yet</b>
                        Import a spreadsheet from Calls or share the apply link. Each person lands here, ranked, as soon as their call is scored.
                      </>
                    )}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="tfoot">
          <span>Sorted by pick, then score · switching the rubric re-ranks instantly, no new calls</span>
          <span>
            Showing <span className="num">{shown.length}</span> of <span className="num">{ranked.length}</span>
          </span>
        </div>
      </div>
    </>
  );
}

function Row({ r }: { r: RankRow }) {
  const atsOff = r.status === "ats_filtered";
  const gap = resumeGap(r.resume_only_score, r.overall);
  const drop = resumeWouldDrop(r.resume_only_score, r.overall);
  const call = callText(r.call);
  return (
    <tr className={atsOff ? "row atsoff" : "row"}>
      <td>
        <div className="who">
          <span className="av" aria-hidden="true">
            {initials(r.candidate.name)}
          </span>
          <div>
            <div className="nm">{r.candidate.name}</div>
            <div className="src">
              {sourceLabel(r.candidate.source)}
              {r.scored ? "" : ` · ${call.text}`}
              {drop ? " · resume filter would drop" : ""}
            </div>
          </div>
        </div>
      </td>
      <td>
        {atsOff ? (
          <span className="chip ats">ATS filtered</span>
        ) : r.pick ? (
          <>
            <span className={`pick ${r.pick}`}>{PICK_LABEL[r.pick]}</span>
            {r.override ? <span className="held">Changed by team</span> : r.held ? <span className="held">Held: {r.held}</span> : null}
          </>
        ) : (
          <span className="status">{STATUS_TEXT[r.status] ?? r.status}</span>
        )}
        {r.status === "shortlisted" ? <span className="decided ok">Shortlisted</span> : null}
        {r.status === "rejected" ? <span className="decided no">Rejected</span> : null}
      </td>
      <td className="col-score">
        {typeof r.overall === "number" && r.scored_pick ? (
          <div className="sc">
            <span className="num">{r.overall}</span>
            <span className={`bar ${r.scored_pick}`}>
              <i style={{ width: `${Math.max(2, r.overall)}%` }} />
            </span>
          </div>
        ) : (
          <span className="num muted">—</span>
        )}
      </td>
      <td className="col-call col-gap">
        {atsOff ? (
          <span className="gapline">
            Resume <b>{gap.resume ?? "n/a"}</b> · not called
          </span>
        ) : gap.call !== null ? (
          <span className="gapline">
            Resume <b>{gap.resume ?? "n/a"}</b> → Call <b>{gap.call}</b>
            {gap.delta !== null && gap.delta !== 0 ? (
              <span className={`delta ${gap.delta > 0 ? "up" : "down"}`}>
                {gap.delta > 0 ? "+" : "−"}
                {Math.abs(gap.delta)}
              </span>
            ) : null}
          </span>
        ) : (
          <span className="gapline">
            Resume <b>{gap.resume ?? "n/a"}</b>
          </span>
        )}
      </td>
      <td className="why col-why">
        <Why r={r} />
      </td>
      <td>
        <Link className="btn2 sm" href={`/candidates/${r.candidate.id}`} aria-label={`Open ${r.candidate.name}`}>
          Open
        </Link>
      </td>
    </tr>
  );
}

function Why({ r }: { r: RankRow }) {
  if (r.status === "ats_filtered") return <>ATS would have dropped · not called</>;
  const f = r.flags;
  const chips = [
    f.otherRole ? <span key="r" className="chip f-role">Fits another role</span> : null,
    f.cultureStandout ? <span key="c" className="chip f-culture">Culture standout</span> : null,
    f.wantsInternship ? <span key="i" className="chip f-intern">Wants internship</span> : null,
    f.resumeMismatch ? <span key="m" className="chip warn">Resume mismatch</span> : null,
  ].filter(Boolean);
  const first = r.summary.split(/(?<=\.)\s/)[0];
  if (!r.scored) return <span className="muted">—</span>;
  return (
    <>
      {first}
      {chips.length ? (
        <div className="chips" style={{ marginTop: 6 }}>
          {chips}
        </div>
      ) : null}
    </>
  );
}
