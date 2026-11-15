import { Suspense } from "react";
import "@/components/results/results.css";
import { canEdit, getMembership } from "@/components/server/session";
import { createClient } from "@/lib/supabase/server";
import { loadTalentPool } from "@/components/results/server/data";
import { HiddenFits } from "@/components/results/hidden-fits";
import { EmptyPage, PageSkeleton } from "@/components/results/page-bits";

export const metadata = { title: "Hidden fits · Pingo" };

export default function HiddenPage() {
  return (
    <Suspense fallback={<PageSkeleton title="People you’d have lost" label="Loading hidden fits" />}>
      <Content />
    </Suspense>
  );
}

async function Content() {
  const me = await getMembership();
  if (!me) return <EmptyPage title="Hidden fits" heading="Your account is not linked to a company yet" body="Ask your Pingo admin to add you, then sign in again." />;
  const db = await createClient();
  const { rows, jobs } = await loadTalentPool(db, me.companyId);
  return (
    <>
      <div className="phead">
        <div>
          <div className="crumb">All jobs</div>
          <h1>People you’d have lost</h1>
          <p className="muted" style={{ marginTop: 6, maxWidth: "70ch" }}>
            Wrong for the job they applied to, worth keeping. A resume filter would have dropped most of them before anyone spoke to them.
          </p>
        </div>
      </div>
      <HiddenFits rows={rows} jobs={jobs} canMove={canEdit(me.role)} />
    </>
  );
}
