import Link from "next/link";
import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { canEdit, getMembership } from "@/components/server/session";
import { formatInt } from "@/components/candidate-format";

export const metadata = { title: "Jobs · Pingo" };

export default function JobsPage() {
  return (
    <Suspense fallback={<JobsSkeleton />}>
      <JobsContent />
    </Suspense>
  );
}

const CALLED = new Set(["calling", "scored", "shortlisted", "rejected"]);

async function JobsContent() {
  const me = await getMembership();
  if (!me) {
    return (
      <Head canCreate={false}>
        <div className="card sec">
          <h2>Your account is not linked to a company yet</h2>
          <p className="hint">Ask your Pingo admin to add you.</p>
        </div>
      </Head>
    );
  }
  const supabase = await createClient();
  const [{ data: jobs, error }, { data: ranking }] = await Promise.all([
    supabase
      .from("jobs")
      .select("id, title, status, ats_mode, created_at")
      .eq("company_id", me.companyId)
      .order("created_at", { ascending: false }),
    supabase.from("candidate_ranking").select("job_id, status, pick, score_id").eq("company_id", me.companyId),
  ]);

  const stats = new Map<string, { applicants: number; called: number; scored: number; amazing: number; good: number }>();
  for (const r of ranking ?? []) {
    if (!r.job_id) continue;
    const s = stats.get(r.job_id) ?? { applicants: 0, called: 0, scored: 0, amazing: 0, good: 0 };
    s.applicants++;
    if (r.status && CALLED.has(r.status)) s.called++;
    if (r.score_id) s.scored++;
    if (r.pick === "amazing") s.amazing++;
    if (r.pick === "good") s.good++;
    stats.set(r.job_id, s);
  }
  const editable = canEdit(me.role);

  return (
    <Head canCreate={editable}>
      <div className="card tcard">
        {error ? (
          <p className="empty">Could not load jobs. Refresh to try again.</p>
        ) : jobs && jobs.length ? (
          <div className="tablewrap">
            <table className="dtable">
              <thead>
                <tr>
                  <th>Job</th>
                  <th>Applicants</th>
                  <th className="col-call">Called</th>
                  <th className="col-score">Scored</th>
                  <th>Amazing · Good</th>
                  <th className="col-why">Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((j) => {
                  const s = stats.get(j.id) ?? { applicants: 0, called: 0, scored: 0, amazing: 0, good: 0 };
                  return (
                    <tr key={j.id} className="row">
                      <td>
                        <Link href={`/dashboard?job=${j.id}`} className="font-semibold text-text hover:text-accent-ink">
                          {j.title}
                        </Link>
                        <div className="label">{j.ats_mode === "ats_filter" ? "ATS filter first" : "Calling everyone"}</div>
                      </td>
                      <td className="num">{formatInt(s.applicants)}</td>
                      <td className="num col-call">{formatInt(s.called)}</td>
                      <td className="num col-score">{formatInt(s.scored)}</td>
                      <td>
                        <span className="num">{formatInt(s.amazing)}</span>
                        <span className="muted"> · </span>
                        <span className="num">{formatInt(s.good)}</span>
                      </td>
                      <td className="col-why">
                        <span className={j.status === "open" ? "chip accent" : "chip"}>{j.status === "open" ? "Open" : "Closed"}</span>
                      </td>
                      <td>
                        <Link className="btn2 sm" href={`/jobs/${j.id}/setup`}>
                          {editable ? "Edit" : "View"}
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty">
            <b>No jobs yet</b>
            {editable ? "Create a job to set the description, rubric and who gets a call." : "An admin or recruiter can create the first job."}
          </div>
        )}
      </div>
    </Head>
  );
}

function Head({ canCreate, children }: { canCreate: boolean; children: React.ReactNode }) {
  return (
    <>
      <div className="phead">
        <div>
          <h1>Jobs</h1>
          <p className="muted" style={{ marginTop: 6 }}>
            Each job has its own description, rubric and calling rules.
          </p>
        </div>
        {canCreate ? (
          <div className="actions">
            <Link className="btn" href="/jobs/new">
              New job
            </Link>
          </div>
        ) : null}
      </div>
      {children}
    </>
  );
}

function JobsSkeleton() {
  return (
    <div aria-busy="true">
      <div className="phead">
        <div>
          <h1>Jobs</h1>
        </div>
      </div>
      <div className="card" style={{ height: 180 }} />
    </div>
  );
}
