import { Suspense } from "react";
import { z } from "zod";
import "@/components/calls/calls.css";
import { canEdit, getMembership } from "@/components/server/session";
import { loadJobs } from "@/components/dashboard/load";
import { createClient } from "@/lib/supabase/server";
import { callingStatus, loadCallbacks } from "@/components/results/server/data";
import { CallsWorkspace } from "@/components/calls/calls-workspace";
import { BatchPanel } from "@/components/calls/batch-panel";
import { CallbacksCard } from "@/components/calls/callbacks-card";
import { JobSwitch } from "@/components/calls/job-switch";
import { EmptyPage, PageSkeleton } from "@/components/results/page-bits";

export const metadata = { title: "Calls · Pingo" };

export default function CallsPage({ searchParams }: PageProps<"/calls">) {
  return (
    <Suspense fallback={<PageSkeleton title="Calls" label="Loading calls" />}>
      <Content searchParams={searchParams} />
    </Suspense>
  );
}

const uuid = z.uuid();

async function Content({ searchParams }: { searchParams: PageProps<"/calls">["searchParams"] }) {
  const [sp, me] = await Promise.all([searchParams, getMembership()]);
  if (!me) return <EmptyPage title="Calls" heading="Your account is not linked to a company yet" body="Ask your Pingo admin to add you, then sign in again." />;
  const jobs = await loadJobs(me);
  const wanted = typeof sp.job === "string" && uuid.safeParse(sp.job).success ? sp.job : undefined;
  const job = jobs.find((j) => j.id === wanted) ?? jobs.find((j) => j.status === "open") ?? jobs[0];
  if (!job) {
    return (
      <EmptyPage
        title="Calls"
        heading="No jobs yet"
        body="Calls are always for a job, so the interviewer knows the role and what to ask. Create one first."
        action={canEdit(me.role) ? { href: "/jobs/new", label: "Create a job" } : undefined}
      />
    );
  }
  const batchId = typeof sp.batch === "string" && uuid.safeParse(sp.batch).success ? sp.batch : null;

  const db = await createClient();
  const [{ data: cands }, callbacks] = await Promise.all([
    db
      .from("candidates")
      .select("id, name, phone, status, created_at")
      .eq("job_id", job.id)
      .neq("status", "ats_filtered")
      .order("created_at", { ascending: false })
      .limit(500),
    loadCallbacks(db, me.companyId),
  ]);
  const status = callingStatus();

  return (
    <>
      <div className="phead">
        <div>
          <div className="crumb">Calls / {job.title}</div>
          <h1>Call a candidate now</h1>
          <p className="muted" style={{ marginTop: 6, maxWidth: "72ch" }}>
            Talk to the AI interviewer in the browser, or have Pingo phone the candidate. Either way they are scored and ranked when the call ends.
          </p>
        </div>
        <div className="actions">
          <JobSwitch jobs={jobs} current={job.id} />
        </div>
      </div>

      <CallsWorkspace
        job={{ id: job.id, title: job.title }}
        candidates={(cands ?? []).map((c) => ({ id: c.id, name: c.name, phoneTail: c.phone.slice(-4), status: c.status }))}
        canCall={canEdit(me.role)}
        callingPaused={status.calling_paused}
        side={
          <>
            <CallbacksCard callbacks={callbacks} />
            <div className="card idlecard">
              <h2>How the screen runs</h2>
              <ol>
                <li>A warm-up, then the candidate’s own story and two questions picked from their resume.</li>
                <li>Role questions in English or Hinglish, whichever the candidate prefers. Ten minutes at most.</li>
                <li>The call is scored on the rubric and lands in the ranking with quotes as evidence.</li>
              </ol>
            </div>
          </>
        }
      />

      <BatchPanel key={job.id} job={{ id: job.id, title: job.title }} canCall={canEdit(me.role)} initialBatchId={batchId} />
    </>
  );
}
