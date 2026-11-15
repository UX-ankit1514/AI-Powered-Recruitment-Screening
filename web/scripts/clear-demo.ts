/**
 * Removes the demo data written by scripts/seed-demo.ts, and nothing else.
 *
 *   npx tsx scripts/clear-demo.ts
 *
 * Deletes only Acme SaaS candidates that are demo-marked (profile.demo = true) AND have a +1555… phone;
 * their calls, scores and audit actions go with them (foreign-key cascade). The demo "Software Engineer
 * (SDE 1)" job is removed too, unless real (non-demo) candidates have since been added to it.
 * The Sales Executive job and its rubric belong to the base seed and are left alone.
 */
import { adminClient } from "./seed";
import { DEMO } from "./seed-demo";

export async function clearDemo() {
  const db = adminClient();
  const { data: demo, error } = await db
    .from("candidates")
    .select("id")
    .eq("company_id", DEMO.companyId)
    .eq("profile->>demo", "true")
    .like("phone", `${DEMO.phonePrefix}%`);
  if (error) throw new Error(`list demo candidates: ${error.message}`);
  const ids = (demo ?? []).map((r) => r.id);

  for (let i = 0; i < ids.length; i += 200) {
    const { error: delErr } = await db
      .from("candidates")
      .delete()
      .in("id", ids.slice(i, i + 200))
      .eq("company_id", DEMO.companyId)
      .eq("profile->>demo", "true")
      .like("phone", `${DEMO.phonePrefix}%`);
    if (delErr) throw new Error(`delete demo candidates: ${delErr.message}`);
  }

  const { count: left } = await db.from("candidates").select("id", { count: "exact", head: true }).eq("job_id", DEMO.sdeJobId);
  let jobRemoved = false;
  if (!left) {
    const { error: jobErr } = await db.from("jobs").delete().eq("id", DEMO.sdeJobId).eq("company_id", DEMO.companyId);
    if (jobErr) throw new Error(`delete SDE job: ${jobErr.message}`);
    jobRemoved = true;
  }
  return { candidates: ids.length, jobRemoved, sdeJobKeptWith: left ?? 0 };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  clearDemo()
    .then((r) =>
      console.log(
        `Demo data cleared: ${r.candidates} candidates (with their calls and scores). ` +
          (r.jobRemoved ? "SDE 1 demo job removed." : `SDE 1 job kept: it has ${r.sdeJobKeptWith} non-demo candidates.`),
      ),
    )
    .catch((e) => {
      console.error("Clear failed:", e instanceof Error ? e.message : e);
      process.exit(1);
    });
}
