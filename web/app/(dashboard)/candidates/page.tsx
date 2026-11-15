import { Suspense } from "react";
import { z } from "zod";
import "@/components/results/results.css";
import { canEdit, getMembership } from "@/components/server/session";
import { loadJobs } from "@/components/dashboard/load";
import { createClient } from "@/lib/supabase/server";
import { loadRanking } from "@/components/results/server/data";
import { CandidatesTable } from "@/components/results/candidates-table";
import { EmptyPage, PageSkeleton } from "@/components/results/page-bits";

export const metadata = { title: "Candidates · Pingo" };

export default function CandidatesPage({ searchParams }: PageProps<"/candidates">) {
  return (
    <Suspense fallback={<PageSkeleton title="Candidates" label="Loading candidates" />}>
      <Content searchParams={searchParams} />
    </Suspense>
  );
}

async function Content({ searchParams }: { searchParams: PageProps<"/candidates">["searchParams"] }) {
  const [sp, me] = await Promise.all([searchParams, getMembership()]);
  if (!me) return <EmptyPage title="Candidates" heading="Your account is not linked to a company yet" body="Ask your Pingo admin to add you, then sign in again." />;
  const jobs = await loadJobs(me);
  const wanted = typeof sp.job === "string" && z.uuid().safeParse(sp.job).success ? sp.job : undefined;
  const pick = jobs.find((j) => j.id === wanted) ?? jobs.find((j) => j.status === "open") ?? jobs[0];
  if (!pick) {
    return (
      <EmptyPage
        title="Candidates"
        heading="No jobs yet"
        body="Create a job first. Everyone who applies or is imported shows up here, ranked by their call."
        action={canEdit(me.role) ? { href: "/jobs/new", label: "Create a job" } : undefined}
      />
    );
  }
  const db = await createClient();
  const r = await loadRanking(db, pick.id);
  if (!r) return <EmptyPage title="Candidates" heading="That job is not available" body="It may have been removed. Pick another job." />;
  return (
    <CandidatesTable
      job={{ id: r.job.id, title: r.job.title }}
      jobs={jobs}
      rubric={r.rubric ? { version: r.rubric.version, weights: r.rubric.weights } : null}
      qualities={r.qualities}
      rows={r.rows}
      canExport={canEdit(me.role)}
    />
  );
}
