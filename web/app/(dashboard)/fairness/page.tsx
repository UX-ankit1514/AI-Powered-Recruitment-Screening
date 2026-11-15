import { Suspense } from "react";
import { z } from "zod";
import { canEdit, getMembership } from "@/components/server/session";
import { loadJobs } from "@/components/dashboard/load";
import { createClient } from "@/lib/supabase/server";
import { loadBiasSummary } from "@/components/fairness/server/load";
import { FairnessView } from "@/components/fairness/fairness-view";
import { EmptyPage, PageSkeleton } from "@/components/results/page-bits";

export const metadata = { title: "Fairness · Pingo" };

export default function FairnessPage({ searchParams }: PageProps<"/fairness">) {
  return (
    <Suspense fallback={<PageSkeleton title="Fairness" label="Loading the fairness breakdown" />}>
      <Content searchParams={searchParams} />
    </Suspense>
  );
}

async function Content({ searchParams }: { searchParams: PageProps<"/fairness">["searchParams"] }) {
  const [sp, me] = await Promise.all([searchParams, getMembership()]);
  if (!me)
    return (
      <EmptyPage
        title="Fairness"
        heading="Your account is not linked to a company yet"
        body="Ask your Pingo admin to add you, then sign in again."
      />
    );
  const jobs = await loadJobs(me);
  const wanted = typeof sp.job === "string" && z.uuid().safeParse(sp.job).success ? sp.job : undefined;
  const pick = jobs.find((j) => j.id === wanted) ?? jobs.find((j) => j.status === "open") ?? jobs[0];
  if (!pick) {
    return (
      <EmptyPage
        title="Fairness"
        heading="No jobs yet"
        body="Create a job and screen a few candidates. This page then checks whether any group is being scored lower for reasons unrelated to the job."
        action={canEdit(me.role) ? { href: "/jobs/new", label: "Create a job" } : undefined}
      />
    );
  }
  // RLS-bound client: only this company's rows are ever read.
  const db = await createClient();
  const summary = await loadBiasSummary(db, pick.id);
  if (!summary)
    return <EmptyPage title="Fairness" heading="That job is not available" body="It may have been removed. Pick another job." />;
  return <FairnessView summary={summary} jobs={jobs} />;
}
