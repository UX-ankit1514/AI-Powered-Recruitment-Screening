import Link from "next/link";
import { Suspense } from "react";
import { canEdit, getMembership } from "@/components/server/session";
import { loadDashboard, loadJobs } from "@/components/dashboard/load";
import { DashboardView } from "@/components/dashboard/dashboard-view";
import { BiasAlert } from "@/components/fairness/bias-alert";
import { loadBiasSummary } from "@/components/fairness/server/load";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Dashboard · Pingo" };

export default function DashboardPage({ searchParams }: PageProps<"/dashboard">) {
  return (
    <Suspense fallback={<DashboardSkeleton />}>
      <DashboardContent searchParams={searchParams} />
    </Suspense>
  );
}

async function DashboardContent({ searchParams }: { searchParams: PageProps<"/dashboard">["searchParams"] }) {
  const [sp, me] = await Promise.all([searchParams, getMembership()]);
  if (!me) {
    return (
      <EmptyState title="Your account is not linked to a company yet" body="Ask your Pingo admin to add you, then sign in again." />
    );
  }
  const jobs = await loadJobs(me);
  const requested = typeof sp.job === "string" ? sp.job : undefined;
  const data = await loadDashboard(me, jobs, requested);
  if (!data) {
    return (
      <EmptyState
        title="No jobs yet"
        body="Add the job description and how you want people ranked. Pingo calls every applicant and ranks them here."
        action={canEdit(me.role) ? { href: "/jobs/new", label: "Create a job" } : undefined}
      />
    );
  }
  const bias = await loadBiasSummary(await createClient(), data.job.id).catch(() => null);
  return (
    <DashboardView
      data={data}
      canEdit={canEdit(me.role)}
      fairness={bias ? <BiasAlert summary={bias} href={`/fairness?job=${data.job.id}`} /> : null}
    />
  );
}

function EmptyState({ title, body, action }: { title: string; body: string; action?: { href: string; label: string } }) {
  return (
    <>
      <div className="phead">
        <div>
          <h1>Dashboard</h1>
        </div>
      </div>
      <div className="card sec" style={{ maxWidth: 640 }}>
        <h2>{title}</h2>
        <p className="hint" style={{ marginTop: 4 }}>
          {body}
        </p>
        {action ? (
          <Link className="btn" href={action.href}>
            {action.label}
          </Link>
        ) : null}
      </div>
    </>
  );
}

function DashboardSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading dashboard">
      <div className="phead">
        <div>
          <div className="crumb">Jobs</div>
          <h1 className="muted">Loading</h1>
        </div>
      </div>
      <div className="kpis">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="card kpi" style={{ height: 126 }} />
        ))}
      </div>
    </div>
  );
}
