import Link from "next/link";
import type { BiasSummary } from "@/lib/fairness/summary";
import { people, score1, signed } from "./format";
import { IconAlert, IconCheck } from "./icons";
import "./fairness.css";

/**
 * Compact bias watch card. Drop it on the dashboard (or anywhere) with a summary from
 * loadBiasSummary(); pass `href` to link through to the full Fairness page.
 * Works as a Server Component (no hooks, no client JS).
 */
export function BiasAlert({ summary, href }: { summary: Pick<BiasSummary, "alerts" | "overall" | "rule">; href?: string }) {
  const { alerts, overall, rule } = summary;
  const enough = overall.n >= rule.minGroupN;
  const tone = alerts.length ? "warn" : "calm";

  return (
    <section className={`card fw-alert fw-alert-${tone}`} aria-label="Fairness check">
      <div className="fw-alert-head">
        {alerts.length ? <IconAlert /> : <IconCheck />}
        <h2>
          {!overall.n
            ? "Fairness check starts after the first scored calls"
            : alerts.length
              ? `${alerts.length} ${alerts.length === 1 ? "group is" : "groups are"} scoring well below average`
              : enough
                ? "No group is scoring well below average"
                : "Too few scored calls to compare groups yet"}
        </h2>
      </div>

      {alerts.length ? (
        <ul className="fw-alert-list">
          {alerts.slice(0, 3).map((a) => (
            <li key={`${a.dimension}:${a.group}`}>
              <span className="fw-alert-group">
                <b>{a.group}</b>
                <span className="muted"> · {a.dimensionLabel.toLowerCase()}</span>
              </span>
              <span className="fw-alert-num">
                <span className="num">{signed(a.gap)}</span> pts · {people(a.n)}
              </span>
            </li>
          ))}
          {alerts.length > 3 ? <li className="muted">and {alerts.length - 3} more</li> : null}
        </ul>
      ) : (
        <p className="fw-alert-body">
          {!overall.n
            ? "Once candidates have been called and scored, we compare score patterns by language, region, how they applied and call quality."
            : enough
              ? `Checked ${people(overall.n)} by language, region, how they applied and call quality. Job average ${score1(overall.mean)}.`
              : `We need at least ${rule.minGroupN} scored candidates in a group before calling anything a pattern. ${people(overall.n)} scored so far.`}
        </p>
      )}

      <p className="fw-alert-foot">
        {alerts.length ? "A signal to review, not proof of bias." : "We never look at gender, caste, religion or age."}
        {href ? (
          <>
            {" "}
            <Link href={href}>See the fairness breakdown</Link>
          </>
        ) : null}
      </p>
    </section>
  );
}
