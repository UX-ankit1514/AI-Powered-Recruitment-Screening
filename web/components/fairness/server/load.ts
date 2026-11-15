import "server-only";
/**
 * Loads the bias watch summary for one job on the CALLER's RLS-bound client (never the service
 * role). A job of another company is invisible to RLS, so it comes back as null (callers 404).
 * bias_inputs is a security_invoker view, so the same RLS applies to every row it returns.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { createClient } from "@/lib/supabase/server";
import { summarizeBias, type BiasInputRow, type BiasSummary } from "@/lib/fairness/summary";

type Db = Awaited<ReturnType<typeof createClient>>;

const PAGE = 1000;
const COLUMNS =
  "candidate_id, source, location, qualities, must_have_results, short_exit, language_mix, hr_review, outcome, duration_s, transcript_for_mix";

export async function loadBiasSummary(db: Db, jobId: string): Promise<BiasSummary | null> {
  const { data: job, error } = await db.from("jobs").select("id, title").eq("id", jobId).maybeSingle();
  if (error) throw new Error("Could not load the job");
  if (!job) return null;

  const { data: rubric } = await db.from("rubrics").select("weights").eq("job_id", jobId).eq("is_current", true).maybeSingle();
  const weights =
    rubric?.weights && typeof rubric.weights === "object" && !Array.isArray(rubric.weights)
      ? (rubric.weights as Record<string, number>)
      : {};

  // bias_inputs is newer than the generated Database types; query it untyped and type the rows here.
  const raw = db as unknown as SupabaseClient;
  const rows: BiasInputRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error: e } = await raw
      .from("bias_inputs")
      .select(COLUMNS)
      .eq("job_id", jobId)
      .order("candidate_id")
      .range(from, from + PAGE - 1);
    if (e) throw new Error("Could not load scores for bias watch");
    rows.push(...((data ?? []) as BiasInputRow[]));
    if (!data || data.length < PAGE) break;
  }
  return summarizeBias({ id: job.id, title: job.title }, rows, weights);
}
