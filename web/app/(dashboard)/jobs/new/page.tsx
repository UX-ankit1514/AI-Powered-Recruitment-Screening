import Link from "next/link";
import { Suspense } from "react";
import { canEdit, getMembership } from "@/components/server/session";
import { NewJobForm } from "@/components/jobs/new-job-form";

export const metadata = { title: "New job · Pingo" };

export default function NewJobPage() {
  return (
    <>
      <div className="phead">
        <div>
          <div className="crumb">
            <Link href="/jobs">Jobs</Link> / New
          </div>
          <h1>New job</h1>
        </div>
      </div>
      <Suspense fallback={<div className="card" style={{ height: 320, maxWidth: 760 }} />}>
        <Gate />
      </Suspense>
    </>
  );
}

async function Gate() {
  const me = await getMembership();
  if (!canEdit(me?.role)) {
    return (
      <div className="card sec" style={{ maxWidth: 640 }}>
        <h2>Only admins and recruiters can create jobs</h2>
        <p className="hint">Ask one of them to set up the role.</p>
      </div>
    );
  }
  return <NewJobForm />;
}
