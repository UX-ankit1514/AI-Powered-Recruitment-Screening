import Image from "next/image";
import { Suspense } from "react";
import { getPublicJob } from "@/lib/ingest/public-job";
import { ApplyForm } from "./apply-form";

export const metadata = { title: "Apply · Pingo", robots: { index: false } };

export default function ApplyPage({ params }: PageProps<"/apply/[jobId]">) {
  return (
    <main className="min-h-screen px-4 py-10 sm:py-16">
      <div className="mx-auto w-full max-w-[520px]">
        <div className="mb-8 flex items-center gap-3">
          <Image src="/pingo-mark.svg" alt="" width={32} height={32} priority />
          <div>
            <div className="text-[18px] font-semibold leading-none tracking-tight">Pingo</div>
            <div className="mt-1 text-[12.5px] text-text-3">Every applicant gets heard</div>
          </div>
        </div>
        <Suspense fallback={<div className="h-[560px] rounded-lg border border-line bg-surface shadow-card" />}>
          <ApplyBody params={params} />
        </Suspense>
      </div>
    </main>
  );
}

async function ApplyBody({ params }: { params: PageProps<"/apply/[jobId]">["params"] }) {
  const { jobId } = await params;
  const job = await getPublicJob(jobId);

  if (!job) {
    return (
      <div className="rounded-lg border border-line bg-surface p-6 shadow-card">
        <h1 className="mb-2 text-[22px] font-semibold tracking-tight">This job is not open</h1>
        <p className="text-text-2">The link may be old, or the role has been filled. Check with the company for a current link.</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-line bg-surface p-6 shadow-card sm:p-7">
      <h1 className="text-[24px] font-semibold leading-tight tracking-tight text-balance">{job.title}</h1>
      <p className="mt-1 mb-6 text-text-2">
        {job.company} · Apply in a minute. You will get a short phone interview, so every application gets a real conversation.
      </p>
      <ApplyForm jobId={job.id} company={job.company} />
    </div>
  );
}
