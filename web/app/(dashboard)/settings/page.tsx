import { Suspense } from "react";
import "@/components/results/results.css";
import { ROLE_LABEL, getMembership } from "@/components/server/session";
import { createClient } from "@/lib/supabase/server";
import { callingStatus, loadSettings } from "@/components/results/server/data";
import { teammateEmails } from "@/components/results/server/team";
import { EmptyPage, PageSkeleton } from "@/components/results/page-bits";
import { MessagingSection } from "@/components/settings/messaging-section";
import { RetentionSettings } from "@/components/settings/retention";
import { LinesForm } from "@/components/settings/lines-form";
import { LINES_BOUNDS, loadLines, schedulerStatus, type SchedulerStatus } from "@/lib/calls/lines";

export const metadata = { title: "Settings · Pingo" };

const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const LANG = "English + Hinglish";

function days(d: number[]) {
  const s = [...new Set(d.map((x) => x % 7))].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
  if (s.length === 7) return "Every day";
  if (s.join() === "1,2,3,4,5,6") return "Mon–Sat";
  if (s.join() === "1,2,3,4,5") return "Mon–Fri";
  return s.map((x) => DAY[x]).join(", ");
}
const SCHEDULER_TEXT: Record<SchedulerStatus["reason"], string> = {
  ok: "Checks the call queue every minute.",
  not_scheduled: "The every-minute job that places queued calls is not set up in the database.",
  no_secret: "The every-minute job is missing its secret in Supabase Vault, so queued calls are never placed.",
  never_ran: "The every-minute job has not run yet. Queued calls wait until it does.",
  stale: "The every-minute job has not run for over 3 minutes. Queued calls are waiting.",
  unknown: "Could not check the scheduler right now.",
};

const joined = (iso: string) => new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }).format(new Date(iso));

export default function SettingsPage() {
  return (
    <Suspense fallback={<PageSkeleton title="Settings" label="Loading settings" />}>
      <Content />
    </Suspense>
  );
}

async function Content() {
  const me = await getMembership();
  if (!me) return <EmptyPage title="Settings" heading="Your account is not linked to a company yet" body="Ask your Pingo admin to add you, then sign in again." />;
  const db = await createClient();
  const [s, lines, scheduler] = await Promise.all([loadSettings(db, me.companyId), loadLines(db, me.companyId), schedulerStatus(db)]);
  const status = callingStatus();
  const emails = await teammateEmails(s.members.map((m) => m.user_id));

  return (
    <>
      <div className="phead">
        <div>
          <h1>Settings</h1>
          <p className="muted" style={{ marginTop: 6 }}>
            Calling setup for {me.companyName || "this workspace"}. Calling hours are set on each job.
          </p>
        </div>
      </div>

      <div className="settings-grid">
        <section className="card" aria-labelledby="s-calling">
          <div className="s-head">
            <h2 id="s-calling">Calling</h2>
          </div>
          <div className="srow">
            <div>
              <b>Bolna voice agent</b>
              <p>Places phone calls and runs the in-browser interview.</p>
            </div>
            <span className={`val ${status.bolna_configured ? "state-ok" : "state-bad"}`}>
              <i className="dot" aria-hidden="true" />
              {status.bolna_configured ? "Connected" : "Not connected"}
            </span>
          </div>
          <div className="srow">
            <div>
              <b>Phone calls</b>
              <p>{status.calling_paused ? "No phone calls go out until an admin turns calling on for the server." : "Queued phone calls are placed inside each job’s calling hours."}</p>
            </div>
            <span className={`val ${status.calling_paused ? "state-off" : "state-ok"}`}>
              <i className="dot" aria-hidden="true" />
              {status.message}
            </span>
          </div>
          <div className="srow">
            <div>
              <b>Scheduler</b>
              <p>{SCHEDULER_TEXT[scheduler.reason]}</p>
            </div>
            <span className={`val ${scheduler.running ? "state-ok" : "state-bad"}`}>
              <i className="dot" aria-hidden="true" />
              {scheduler.running ? "Running" : "Scheduler not running"}
            </span>
          </div>
          <LinesForm initial={lines.lines} custom={lines.custom} fallback={lines.default} canEdit={me.role === "admin"} bounds={LINES_BOUNDS} />
          <div className="srow">
            <div>
              <b>Call length limit</b>
              <p>The interviewer wraps up politely at the limit.</p>
            </div>
            <span className="val num">10 min</span>
          </div>
          <div className="srow">
            <div>
              <b>Languages</b>
              <p>The candidate picks; the interviewer follows.</p>
            </div>
            <span className="val">{LANG}</span>
          </div>
        </section>

        <section className="card" aria-labelledby="s-team">
          <div className="s-head">
            <h2 id="s-team">Team</h2>
            <p>Who can see this workspace. Admins and recruiters decide; hiring managers read and add notes.</p>
          </div>
          <table className="s-table" style={{ marginTop: 10 }}>
            <thead>
              <tr>
                <th>Member</th>
                <th>Role</th>
                <th>Joined</th>
              </tr>
            </thead>
            <tbody>
              {s.members.map((m) => (
                <tr key={m.user_id}>
                  <td>
                    {emails.get(m.user_id) ?? "Teammate"}
                    {m.user_id === me.userId ? <span className="muted"> · you</span> : null}
                  </td>
                  <td>{ROLE_LABEL[m.role]}</td>
                  <td className="num" style={{ fontSize: 12.5 }}>
                    {joined(m.created_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <RetentionSettings />
        <section className="card full" aria-labelledby="s-jobs">
          <div className="s-head">
            <h2 id="s-jobs">Calling hours per job</h2>
            <p>Each job’s calls go out only inside its hours (India time), sharing the company’s call lines.</p>
          </div>
          {s.jobs.length ? (
            <div className="tablewrap">
              <table className="s-table" style={{ marginTop: 10 }}>
                <thead>
                  <tr>
                    <th>Job</th>
                    <th>Status</th>
                    <th>Hours</th>
                  </tr>
                </thead>
                <tbody>
                  {s.jobs.map((j) => (
                    <tr key={j.id}>
                      <td>{j.title}</td>
                      <td>{j.status === "open" ? "Open" : "Closed"}</td>
                      <td>
                        {j.hours ? (
                          <>
                            <span className="num">
                              {j.hours.start}–{j.hours.end}
                            </span>{" "}
                            · {days(j.hours.days)}
                          </>
                        ) : (
                          "Not set"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="hint" style={{ padding: "8px 22px 18px" }}>
              No jobs yet.
            </p>
          )}
        </section>
        <MessagingSection />
      </div>
    </>
  );
}
