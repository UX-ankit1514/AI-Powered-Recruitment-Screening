"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { RUBRIC_PRESETS } from "@/lib/types";
import {
  PICK_LABEL,
  PICK_ORDER,
  callText,
  computeOverall,
  formatInt,
  formatRupees,
  hasFailedMustHave,
  initials,
  isHiddenFit,
  mmss,
  pickFor,
  sourceLabel,
  type PickValue,
} from "@/components/candidate-format";
import { IconSearch } from "@/components/icons";
import type { DashCandidate, DashboardData, LiveCall } from "./load";

type Ranked = {
  c: DashCandidate;
  overall: number | null;
  pick: PickValue | null;
  capped: string | null;
  atsOff: boolean;
};
type Filter = "all" | PickValue | "hidden";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "amazing", label: "Amazing" },
  { id: "good", label: "Good" },
  { id: "maybe", label: "Maybe" },
  { id: "no", label: "No" },
  { id: "hidden", label: "Hidden fits" },
];

const STATUS_TEXT: Record<string, string> = {
  imported: "Not called yet",
  queued: "Queued",
  calling: "On a call",
  scored: "Not enough evidence",
  shortlisted: "Shortlisted",
  rejected: "Rejected",
};

const LANG_LABEL: Record<string, string> = { en: "English", hinglish: "Hinglish" };

function rank(cands: DashCandidate[], weights: Record<string, number>): Ranked[] {
  return cands
    .map((c) => {
      const atsOff = c.status === "ats_filtered";
      const overall = c.scored ? computeOverall(c.qualities, weights) : null;
      const pick = pickFor(overall, { short_exit: c.shortExit, must_have_results: c.mustHaveResults });
      const uncapped = pickFor(overall);
      const capped =
        pick === "maybe" && (uncapped === "amazing" || uncapped === "good")
          ? c.shortExit
            ? "call ended early"
            : hasFailedMustHave({ must_have_results: c.mustHaveResults })
              ? "must-have not met"
              : null
          : null;
      return { c, overall, pick, capped, atsOff };
    })
    .sort(
      (a, b) =>
        Number(a.atsOff) - Number(b.atsOff) ||
        (a.pick ? PICK_ORDER[a.pick] : 9) - (b.pick ? PICK_ORDER[b.pick] : 9) ||
        (b.overall ?? -1) - (a.overall ?? -1) ||
        a.c.name.localeCompare(b.c.name),
    );
}

export function DashboardView({ data, canEdit }: { data: DashboardData; canEdit: boolean }) {
  const { job, rubric, candidates, kpi, live } = data;
  const [preset, setPreset] = useState<string>(rubric ? "saved" : "balanced");
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");

  const weights = useMemo<Record<string, number>>(() => {
    if (preset === "saved" && rubric) return rubric.weights;
    const p = RUBRIC_PRESETS.find((x) => x.id === preset) ?? RUBRIC_PRESETS[0];
    return p.weights as Record<string, number>;
  }, [preset, rubric]);

  const ranked = useMemo(() => rank(candidates, weights), [candidates, weights]);

  const counts = useMemo(() => {
    const n: Record<Filter, number> = { all: ranked.length, amazing: 0, good: 0, maybe: 0, no: 0, hidden: 0 };
    for (const r of ranked) {
      if (r.atsOff) continue;
      if (r.pick) n[r.pick]++;
      if (isHiddenFit(r.c.flags)) n.hidden++;
    }
    return n;
  }, [ranked]);
  const scoredCount = counts.amazing + counts.good + counts.maybe + counts.no;

  const needle = q.trim().toLowerCase();
  const shown = ranked.filter((r) => {
    if (needle && !`${r.c.name} ${r.c.summary} ${sourceLabel(r.c.source)}`.toLowerCase().includes(needle)) return false;
    if (filter === "all") return true;
    if (r.atsOff) return false;
    if (filter === "hidden") return isHiddenFit(r.c.flags);
    return r.pick === filter;
  });

  const completedPct = kpi.applicants ? Math.round((kpi.completed / kpi.applicants) * 100) : 0;
  const perCall = kpi.completed ? kpi.spend / kpi.completed : 0;
  const langs = job.languages.map((l) => LANG_LABEL[l] ?? l).join(" + ");
  const setupHref = `/jobs/${job.id}/setup`;

  return (
    <>
      <div className="phead">
        <div>
          <div className="crumb">
            <Link href="/jobs">Jobs</Link> / {job.title}
          </div>
          <h1>{job.title}</h1>
          <div className="chips">
            <label className="rubric">
              Rubric:
              <select value={preset} onChange={(e) => setPreset(e.target.value)} aria-label="Rank by rubric">
                {rubric ? <option value="saved">Saved (v{rubric.version})</option> : null}
                {RUBRIC_PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <Link className="chip chip-link" href={setupHref}>
              {job.atsMode === "ats_filter" ? `ATS: top ${job.atsTopPct}%` : "Calling everyone"}
            </Link>
            {canEdit ? (
              <Link className="chip chip-link" href={setupHref}>
                Customise rubric →
              </Link>
            ) : null}
            {langs ? <span className="chip">{langs}</span> : null}
            {data.otherOpenRoles > 0 ? (
              <span className="chip">
                {data.otherOpenRoles} other open role{data.otherOpenRoles === 1 ? "" : "s"}
              </span>
            ) : null}
          </div>
        </div>
        <div className="actions with-search">
          <div className="search">
            <IconSearch className="i" />
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or summary" aria-label="Search candidates" />
          </div>
        </div>
      </div>

      <div className="kpis">
        <div className="card kpi">
          <div className="label">Applicants</div>
          <div className="big">{formatInt(kpi.applicants)}</div>
          <p>{kpi.sources.length ? kpi.sources.map((s) => `${s.label} ${formatInt(s.count)}`).join(" · ") : "None imported yet"}</p>
        </div>
        <div className="card kpi">
          <div className="label">Calls completed</div>
          <div className="big">{formatInt(kpi.completed)}</div>
          <div className="bar" role="meter" aria-label="Share of applicants with a completed call" aria-valuemin={0} aria-valuemax={100} aria-valuenow={completedPct}>
            <i style={{ width: `${completedPct}%` }} />
          </div>
          <p>
            {completedPct}% of applicants · {formatInt(kpi.shortExits)} short exit{kpi.shortExits === 1 ? "" : "s"}
          </p>
        </div>
        <div className="card kpi">
          <div className="label">Hidden fits found</div>
          <div className="big">{formatInt(kpi.hiddenFits.total)}</div>
          <p>
            Other role {kpi.hiddenFits.otherRole} · Culture {kpi.hiddenFits.culture} · Internship {kpi.hiddenFits.internship}
          </p>
        </div>
        <div className="card kpi">
          <div className="label">Spend so far</div>
          <div className="big">{formatRupees(kpi.spend)}</div>
          <p>{kpi.completed ? `~${formatRupees(perCall)} per completed call` : "Nothing spent yet"}</p>
        </div>
      </div>

      <div className="dash">
        <div className="stack">
          <div className="card picks">
            <div className="picks-top">
              <h2>
                Picks from {formatInt(scoredCount)} scored call{scoredCount === 1 ? "" : "s"}
              </h2>
              <span className="label">
                Pipeline: {formatInt(kpi.pipeline.queued)} queued · {formatInt(kpi.pipeline.retrying)} retrying · {formatInt(kpi.pipeline.onCall)} on a call
              </span>
            </div>
            {scoredCount ? (
              <div className="stacked" aria-hidden="true">
                {(["amazing", "good", "maybe", "no"] as const).map((p) =>
                  counts[p] ? <i key={p} className={`c-${p}`} style={{ flex: counts[p] }} /> : null,
                )}
              </div>
            ) : (
              <div className="stacked empty-bar" aria-hidden="true" />
            )}
            <div className="legend">
              {(["amazing", "good", "maybe", "no"] as const).map((p) => (
                <span key={p} className={`c-${p}`}>
                  {PICK_LABEL[p]} <b>{counts[p]}</b>
                </span>
              ))}
            </div>
          </div>

          <div className="card tcard">
            <div className="filters" role="group" aria-label="Filter by pick">
              {FILTERS.map((f) => (
                <button key={f.id} type="button" className="fbtn" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
                  {f.label}
                  <span className="num">{counts[f.id]}</span>
                </button>
              ))}
            </div>
            <div className="tablewrap">
              <table className="dtable">
                <thead>
                  <tr>
                    <th>Candidate</th>
                    <th>Pick</th>
                    <th className="col-score">Score</th>
                    <th className="col-call">Call</th>
                    <th className="col-why">Why / flags</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.length ? (
                    shown.map((r) => <Row key={r.c.id} r={r} />)
                  ) : (
                    <tr>
                      <td colSpan={6} className="empty">
                        {candidates.length ? (
                          "Nobody matches. Clear the search or pick another filter."
                        ) : (
                          <>
                            <b>No applicants yet</b>
                            Import a spreadsheet or share the apply link. Each person lands here, ranked, as soon as their call is scored.
                          </>
                        )}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="tfoot">
              <span>Sorted by pick, then score · switching the rubric re-ranks instantly</span>
              <span>
                Showing {shown.length} of {ranked.length}
              </span>
            </div>
          </div>
        </div>

        <aside className="rail" aria-label="Activity">
          <OnCallNow live={live} />
          <div className="card hf">
            <h2>Hidden fits</h2>
            <p>People who are wrong for this job but worth keeping.</p>
            <Link className="hfrow t-green" href="/talent-pool">
              Fits another role<span className="num">{kpi.hiddenFits.otherRole}</span>
            </Link>
            <Link className="hfrow t-blue" href="/talent-pool">
              Culture standout<span className="num">{kpi.hiddenFits.culture}</span>
            </Link>
            <Link className="hfrow t-yellow" href="/talent-pool">
              Wants an internship<span className="num">{kpi.hiddenFits.internship}</span>
            </Link>
            <Link className="hfrow t-red" href="/talent-pool">
              Resume doesn’t match<span className="num">{kpi.hiddenFits.mismatch}</span>
            </Link>
            <Link className="hfrow t-grey" href="/talent-pool">
              HR to review<span className="num">{kpi.hiddenFits.hrReview}</span>
            </Link>
          </div>
        </aside>
      </div>
    </>
  );
}

function Row({ r }: { r: Ranked }) {
  const { c, overall, pick, capped, atsOff } = r;
  const hook = typeof c.resumeScore === "number" && c.resumeScore < 50 && typeof overall === "number" && overall >= 65;
  const call = callText(c.call);
  return (
    <tr className={atsOff ? "row atsoff" : "row"}>
      <td>
        <div className="who">
          <span className="av" aria-hidden="true">
            {initials(c.name)}
          </span>
          <div>
            <div className="nm">{c.name}</div>
            <div className="src">
              {sourceLabel(c.source)}
              {hook ? " · resume filter would drop" : ""}
            </div>
          </div>
        </div>
      </td>
      <td>
        {atsOff ? (
          <span className="chip ats">ATS filtered</span>
        ) : pick ? (
          <>
            <span className={`pick ${pick}`}>{PICK_LABEL[pick]}</span>
            {capped ? <span className="held">Held: {capped}</span> : null}
          </>
        ) : (
          <span className="status">{STATUS_TEXT[c.status] ?? c.status}</span>
        )}
      </td>
      <td className="col-score">
        {typeof overall === "number" && pick ? (
          <div className="sc">
            <span className="num">{overall}</span>
            <span className={`bar ${pick}`}>
              <i style={{ width: `${Math.max(2, overall)}%` }} />
            </span>
          </div>
        ) : (
          <span className="num muted">—</span>
        )}
      </td>
      <td className="callcell col-call">
        {atsOff ? (
          <>Not called · resume {typeof c.resumeScore === "number" ? Math.round(c.resumeScore) : "n/a"}</>
        ) : (
          <>
            {call.text}
            {call.duration ? (
              <>
                {" · "}
                <span className="num">{call.duration}</span>
              </>
            ) : null}
          </>
        )}
      </td>
      <td className="why col-why">
        <WhyCell r={r} hook={hook} />
      </td>
      <td>
        <Link className="btn2 sm" href={`/candidates/${c.id}`} aria-label={`Open ${c.name}`}>
          Open
        </Link>
      </td>
    </tr>
  );
}

function WhyCell({ r, hook }: { r: Ranked; hook: boolean }) {
  const { c, overall, capped, atsOff } = r;
  if (atsOff) return <>Filtered by ATS · not called</>;
  if (hook && typeof c.resumeScore === "number") {
    return (
      <span className="chip hook">
        Resume filter would drop · Resume {Math.round(c.resumeScore)} → Call {overall}
      </span>
    );
  }
  const f = c.flags;
  const chips = [
    f.otherRole ? <span key="r" className="chip f-role">Fits another role: {f.otherRole}</span> : null,
    f.cultureStandout ? <span key="c" className="chip f-culture">Culture standout</span> : null,
    f.wantsInternship ? <span key="i" className="chip f-intern">Wants internship</span> : null,
    f.resumeMismatch ? <span key="m" className="chip warn">Resume mismatch</span> : null,
  ].filter(Boolean);
  if (chips.length) return <div className="chips">{chips}</div>;
  if (capped) return <>Held at Maybe: {capped}</>;
  if (!c.scored) return <span className="muted">—</span>;
  return <>{c.summary.split(/(?<=\.)\s/)[0]}</>;
}

/** Real in-progress calls; the timer ticks locally from the call's start time. */
function OnCallNow({ live }: { live: LiveCall[] }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    if (!live.length) return;
    const tick = () => setNow(Date.now());
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [live.length]);

  return (
    <div className="oncall" aria-live="polite">
      <div className="oncall-top">
        <h2>On a call now</h2>
        {live.length ? <span className="live">Live</span> : null}
      </div>
      {live.length ? (
        live.map((l) => {
          const started = l.startedAt ? Date.parse(l.startedAt) : NaN;
          const el = now && Number.isFinite(started) ? Math.max(0, (now - started) / 1000) : null;
          return (
            <div key={l.id} className="lc">
              <div className="lc-top">
                <span>{l.name}</span>
                <span className="num">{el !== null && l.state === "in_call" ? mmss(el) : ""}</span>
              </div>
              <p>{l.state === "in_call" ? "On the call now" : "Dialling"}</p>
              <div className="bar">
                <i style={{ width: `${el !== null && l.state === "in_call" ? Math.min(100, el / 6) : 0}%` }} />
              </div>
            </div>
          );
        })
      ) : (
        <div className="lc idle">
          <div className="lc-top">
            <span>No calls right now</span>
          </div>
          <p>When screening starts, each live call shows up here with its timer.</p>
        </div>
      )}
      <small>{live.length ? "Bar shows time used of the 10-minute limit" : "Calls run only inside calling hours"}</small>
    </div>
  );
}
