import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { canEdit, getMembership } from "@/components/server/session";
import { SetupEditor, type SetupInitial } from "@/components/jobs/setup-editor";
import { CallingHoursSchema, CultureValueSchema, CustomTraitSchema, FaqItemSchema, MustHaveSchema, WeightsSchema } from "@/lib/types";

export const metadata = { title: "Job & rubric · Pingo" };

export default function SetupPage({ params }: PageProps<"/jobs/[id]/setup">) {
  return (
    <Suspense fallback={<SetupSkeleton />}>
      <SetupContent params={params} />
    </Suspense>
  );
}

const arr = <T extends z.ZodTypeAny>(s: T, v: unknown): z.infer<T>[] => {
  const r = z.array(s).safeParse(v);
  return r.success ? r.data : [];
};

async function SetupContent({ params }: { params: PageProps<"/jobs/[id]/setup">["params"] }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const me = await getMembership();
  if (!me) notFound();

  const supabase = await createClient();
  const [{ data: job }, { data: rubric }, { count }] = await Promise.all([
    supabase
      .from("jobs")
      .select("id, title, jd_text, status, calling_hours, ats_mode, ats_top_pct, ats_rescue, languages, culture_values, faq")
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("rubrics")
      .select("version, weights, custom_traits, must_haves, nice_to_haves")
      .eq("job_id", id)
      .eq("is_current", true)
      .maybeSingle(),
    supabase.from("candidates").select("id", { count: "exact", head: true }).eq("job_id", id),
  ]);
  if (!job) notFound();

  const hours = CallingHoursSchema.safeParse(job.calling_hours);
  const weights = WeightsSchema.safeParse(rubric?.weights);
  const initial: SetupInitial = {
    jobId: job.id,
    title: job.title,
    jd: job.jd_text,
    values: arr(CultureValueSchema, job.culture_values),
    faq: arr(FaqItemSchema, job.faq),
    hours: hours.success ? hours.data : { start: "10:00", end: "19:00", days: [1, 2, 3, 4, 5, 6] },
    languages: job.languages,
    atsMode: job.ats_mode === "ats_filter" ? "ats_filter" : "call_everyone",
    atsTopPct: job.ats_top_pct,
    atsRescue: job.ats_rescue,
    rubricVersion: rubric?.version ?? 0,
    weights: weights.success ? weights.data : { skills: 30, experience: 30, culture_fit: 25, confidence: 15 },
    traits: arr(CustomTraitSchema, rubric?.custom_traits),
    mustHaves: arr(MustHaveSchema, rubric?.must_haves).map((m) => m.text),
    niceToHaves: arr(MustHaveSchema, rubric?.nice_to_haves).map((m) => m.text),
    applicants: count ?? 0,
  };

  return (
    <>
      <div className="phead">
        <div>
          <div className="crumb">
            <Link href="/jobs">Jobs</Link> / {job.title}
          </div>
          <h1>Job &amp; custom rubric</h1>
          <p className="muted" style={{ marginTop: 6 }}>
            What the interviewer knows, and how candidates are ranked. Saving the rubric re-ranks everyone straight away.
          </p>
        </div>
        <div className="actions">
          <Link className="btn2" href={`/dashboard?job=${job.id}`}>
            See ranking
          </Link>
        </div>
      </div>
      <SetupEditor initial={initial} editable={canEdit(me.role)} />
    </>
  );
}

function SetupSkeleton() {
  return (
    <div aria-busy="true">
      <div className="phead">
        <div>
          <div className="crumb">Jobs</div>
          <h1>Job &amp; custom rubric</h1>
        </div>
      </div>
      <div className="jobs">
        <div className="card" style={{ height: 520 }} />
        <div className="card" style={{ height: 520 }} />
      </div>
    </div>
  );
}
