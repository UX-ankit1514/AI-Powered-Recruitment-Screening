import type { BiasSummary, DimensionSummary, GroupStat } from "@/lib/fairness/summary";
import { SHORT_CALL_SECONDS } from "@/lib/fairness/groups";
import { BiasAlert } from "./bias-alert";
import { FairnessJobPicker } from "./job-picker";
import { pct, people, score1, signed } from "./format";
import { IconAlert, IconEye } from "./icons";
import "./fairness.css";

type JobPick = { id: string; title: string; status: string };

export function FairnessView({ summary, jobs }: { summary: BiasSummary; jobs: JobPick[] }) {
  const { overall, rule } = summary;
  return (
    <>
      <div className="phead">
        <div>
          <div className="crumb">{summary.job.title}</div>
          <h1>Fairness</h1>
          <p className="muted fw-lede">
            Are some groups of candidates scored lower for reasons that have nothing to do with the job? We compare score patterns by the
            language people spoke, where they live, how they applied and how good the call line was.
          </p>
        </div>
        <FairnessJobPicker jobs={jobs} current={summary.job.id} />
      </div>

      <div className="fw-top">
        <BiasAlert summary={summary} />
        <section className="card fw-how" aria-label="How to read this page">
          <h2>How to read this</h2>
          <p>
            <b>These are signals to review, not proof of bias.</b> A group can score lower for fair reasons, for example if fewer of them
            meet a must-have. Open a few of their calls and check the evidence quotes before drawing a conclusion.
          </p>
          <p>
            We raise a flag when a group has at least <b className="num">{rule.minGroupN}</b> scored candidates and its average is{" "}
            <b className="num">{rule.flagGap}</b> or more points below the job average. Smaller groups that look low are marked{" "}
            <i>keep watching</i>.
          </p>
          <p className="muted">
            Language is read from the candidate’s own words on the call. We never look at gender, caste, religion or age, and never guess
            them from names or voices.
          </p>
        </section>
      </div>

      <div className="fw-strip" role="group" aria-label="Whole job">
        <span>
          Job average <b className="num">{score1(overall.mean)}</b>
        </span>
        <span>
          Scored <b className="num">{overall.n}</b>
        </span>
        <span>
          Amazing or Good <b className="num">{overall.n ? pct(overall.shareGood) : "–"}</b>
        </span>
        <span>
          Short exits <b className="num">{overall.n ? pct(overall.shortExitRate) : "–"}</b>
        </span>
        {summary.unscored ? <span className="muted">{people(summary.unscored)} with nothing scorable left out</span> : null}
      </div>

      {overall.n === 0 ? (
        <div className="card sec fw-empty">
          <h2>No scored calls for this job yet</h2>
          <p className="hint">The breakdown fills in as soon as candidates finish their screening calls.</p>
        </div>
      ) : (
        <div className="fw-dims">
          {summary.dimensions.map((d) => (
            <Dimension key={d.key} d={d} jobMean={overall.mean ?? 0} />
          ))}
        </div>
      )}
    </>
  );
}

function Dimension({ d, jobMean }: { d: DimensionSummary; jobMean: number }) {
  const flagged = d.groups.filter((g) => g.status === "flag").length;
  return (
    <section className="card fw-dim" aria-labelledby={`fw-${d.key}`}>
      <header className="fw-dim-head">
        <div>
          <h2 id={`fw-${d.key}`}>{d.label}</h2>
          <p className="hint">
            {d.question}
            {d.key === "call_quality" ? ` Cut short means under ${SHORT_CALL_SECONDS / 60} minutes and not a planned short exit.` : ""}
          </p>
        </div>
        {flagged ? (
          <span className="chip warn">
            <IconAlert className="i fw-chip-i" />
            {flagged} to review
          </span>
        ) : null}
      </header>
      <div className="fw-key" aria-hidden="true">
        <span className="fw-key-bar">Group average</span>
        <span className="fw-key-tick">Job average {score1(jobMean)}</span>
      </div>
      <div className="fw-scroll">
        <table className="fw-table">
          <caption className="sr-only">
            {d.label}: average score per group compared with the job average of {score1(jobMean)}
          </caption>
          <thead>
            <tr>
              <th scope="col">Group</th>
              <th scope="col" className="r">
                People
              </th>
              <th scope="col" className="fw-chartcol">
                Average score <span className="fw-axis">out of 100</span>
              </th>
              <th scope="col" className="r">
                vs job
              </th>
              <th scope="col" className="r">
                Amazing or Good
              </th>
              <th scope="col" className="r">
                Short exits
              </th>
              <th scope="col">Signal</th>
            </tr>
          </thead>
          <tbody>
            {d.groups.map((g) => (
              <Row key={g.key} g={g} jobMean={jobMean} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Row({ g, jobMean }: { g: GroupStat; jobMean: number }) {
  const tip = `${g.label}: average ${score1(g.mean)} from ${people(g.n)}, ${signed(g.gap)} vs the job average`;
  return (
    <tr className={g.status === "flag" ? "is-flag" : undefined}>
      <th scope="row">{g.label}</th>
      <td className="r num">{g.n}</td>
      <td className="fw-chartcol">
        <div className="fw-barwrap">
          <div className={`fw-bar s-${g.status}`} data-tip={tip} aria-hidden="true">
            <i style={{ width: `${Math.max(1, Math.min(100, g.mean))}%` }} />
            <b className="fw-tick" style={{ left: `${Math.max(0, Math.min(100, jobMean))}%` }} />
          </div>
          <span className="num fw-val">{score1(g.mean)}</span>
        </div>
      </td>
      <td className={`r num ${g.gap <= -1 ? "fw-down" : ""}`}>{signed(g.gap)}</td>
      <td className="r num">{pct(g.shareGood)}</td>
      <td className="r num">{pct(g.shortExitRate)}</td>
      <td>
        <Signal g={g} />
      </td>
    </tr>
  );
}

function Signal({ g }: { g: GroupStat }) {
  if (g.status === "flag")
    return (
      <span className="chip warn">
        <IconAlert className="i fw-chip-i" />
        Review
      </span>
    );
  if (g.status === "watch")
    return (
      <span className="chip f-intern">
        <IconEye className="i fw-chip-i" />
        Keep watching
      </span>
    );
  if (g.status === "too_few") return <span className="muted">Too few to judge</span>;
  return <span className="muted">No signal</span>;
}
