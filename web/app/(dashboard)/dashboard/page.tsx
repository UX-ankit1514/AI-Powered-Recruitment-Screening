import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Dashboard · Pingo" };

const ROLE_LABEL = { admin: "Admin", recruiter: "Recruiter", hiring_manager: "Hiring manager" } as const;

export default function DashboardPage() {
  return (
    <Suspense fallback={<p className="text-text-3">Loading dashboard</p>}>
      <DashboardContent />
    </Suspense>
  );
}

async function DashboardContent() {
  const supabase = await createClient();
  // RLS scopes both queries to the signed-in user's company.
  const [{ data: memberships }, { data: jobs, error: jobsError }] = await Promise.all([
    supabase.from("members").select("role, company:companies(id, name)"),
    supabase.from("jobs").select("id, title, status, ats_mode, languages, created_at").order("created_at", { ascending: false }),
  ]);

  const { data: auth } = await supabase.auth.getClaims();
  const mine = memberships?.find(() => true);
  const companyName = mine?.company?.name;

  return (
    <div>
      <p className="mb-1.5 text-[13px] text-text-3">{companyName ?? "No company"}</p>
      <h1 className="text-[30px] font-semibold leading-tight tracking-tight">Dashboard</h1>
      <p className="mt-1 text-text-2">
        Signed in as {String(auth?.claims.email ?? "")}
        {mine ? ` · ${ROLE_LABEL[mine.role]}` : ""}
      </p>

      {!companyName ? (
        <div className="mt-6 rounded-lg border border-line bg-surface p-6 shadow-card">
          <p className="font-medium">Your account is not linked to a company yet.</p>
          <p className="mt-1 text-text-2">Ask your Pingo admin to add you.</p>
        </div>
      ) : (
        <section className="mt-6 rounded-lg border border-line bg-surface shadow-card">
          <header className="flex items-baseline justify-between border-b border-line px-5 py-4">
            <h2 className="text-[17px] font-semibold">Jobs</h2>
            <span className="num text-[12.5px] text-text-3">{jobs?.length ?? 0}</span>
          </header>
          {jobsError ? (
            <p className="px-5 py-4 text-red">Could not load jobs. Refresh to try again.</p>
          ) : jobs && jobs.length > 0 ? (
            <table className="w-full text-left">
              <thead>
                <tr className="text-[11.5px] uppercase tracking-wide text-text-3">
                  <th className="px-5 py-2.5 font-medium">Title</th>
                  <th className="px-5 py-2.5 font-medium">Who gets a call</th>
                  <th className="px-5 py-2.5 font-medium">Languages</th>
                  <th className="px-5 py-2.5 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => (
                  <tr key={job.id} className="border-t border-line">
                    <td className="px-5 py-3 font-medium">{job.title}</td>
                    <td className="px-5 py-3 text-text-2">{job.ats_mode === "ats_filter" ? "ATS filter" : "Everyone"}</td>
                    <td className="px-5 py-3 text-text-2">{job.languages.join(", ")}</td>
                    <td className="px-5 py-3">
                      <span className="rounded-full bg-accent-soft px-2.5 py-0.5 text-[12.5px] font-medium capitalize text-accent-ink">
                        {job.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="px-5 py-4 text-text-2">No jobs yet.</p>
          )}
        </section>
      )}
    </div>
  );
}
