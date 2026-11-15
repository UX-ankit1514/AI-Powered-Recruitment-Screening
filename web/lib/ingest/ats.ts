/**
 * "Who gets a call" pre-filter (build-spec-delta 2, ported from /demo atsCalc).
 * ats_filter: keep the top `top_pct` % by resume_only_score; with the rescue lane on,
 * anyone within 10 points of the cutoff is still called. Everyone else -> 'ats_filtered'.
 * call_everyone: any previously filtered candidate goes back to 'imported'.
 * Candidates without a resume score are never filtered (nothing to judge them on).
 * Only 'imported' / 'ats_filtered' candidates are touched; queued/called ones are left alone.
 */
import type { DB } from "./http";

export const RESCUE_POINTS = 10;

export type AtsCandidate = { id: string; resume_only_score: number | null };
export type AtsSettings = { ats_mode: string; ats_top_pct: number; ats_rescue: boolean };

export function computeAtsSplit(cands: AtsCandidate[], s: AtsSettings) {
  const filtered = new Set<string>();
  const rescued = new Set<string>();
  if (s.ats_mode !== "ats_filter") return { filtered, rescued, cutoff: null as number | null };

  const pool = cands
    .filter((c) => typeof c.resume_only_score === "number" && Number.isFinite(c.resume_only_score))
    .sort((a, b) => (b.resume_only_score as number) - (a.resume_only_score as number));
  if (!pool.length) return { filtered, rescued, cutoff: null as number | null };

  const pct = Math.min(100, Math.max(10, s.ats_top_pct));
  const keep = Math.max(1, Math.ceil((pool.length * pct) / 100));
  const cutoff = pool[keep - 1].resume_only_score as number;
  pool.forEach((c, i) => {
    if (i < keep) return;
    const score = c.resume_only_score as number;
    if (score >= cutoff) return; // ties with the cutoff are kept
    if (s.ats_rescue && score >= cutoff - RESCUE_POINTS) rescued.add(c.id);
    else filtered.add(c.id);
  });
  return { filtered, rescued, cutoff };
}

export type AtsResult = { mode: string; cutoff: number | null; filtered: number; rescued: number; considered: number };

/**
 * Applies the job's ATS setting to its not-yet-called candidates.
 * `db` defaults to the signed-in user's client (RLS: admin/recruiter only can write).
 */
export async function applyAtsFilter(jobId: string, db?: DB): Promise<AtsResult> {
  const client = db ?? ((await (await import("../supabase/server")).createClient()) as unknown as DB);
  const { data: job, error: jobErr } = await client
    .from("jobs")
    .select("id, ats_mode, ats_top_pct, ats_rescue")
    .eq("id", jobId)
    .maybeSingle();
  if (jobErr || !job) throw new Error("job not found");

  const { data: cands, error } = await client
    .from("candidates")
    .select("id, resume_only_score, status")
    .eq("job_id", jobId)
    .in("status", ["imported", "ats_filtered"]);
  if (error) throw new Error("could not load candidates");

  const list = (cands ?? []).map((c) => ({
    id: c.id,
    status: c.status,
    resume_only_score: c.resume_only_score == null ? null : Number(c.resume_only_score),
  }));
  const split = computeAtsSplit(list, job);

  const toFilter = list.filter((c) => split.filtered.has(c.id) && c.status !== "ats_filtered").map((c) => c.id);
  const toRestore = list.filter((c) => !split.filtered.has(c.id) && c.status === "ats_filtered").map((c) => c.id);

  for (const [ids, status] of [
    [toFilter, "ats_filtered"],
    [toRestore, "imported"],
  ] as const) {
    for (let i = 0; i < ids.length; i += 200) {
      const chunk = ids.slice(i, i + 200);
      const { error: upErr } = await client
        .from("candidates")
        .update({ status })
        .in("id", chunk)
        .eq("job_id", jobId)
        .in("status", ["imported", "ats_filtered"]);
      if (upErr) throw new Error("could not update candidate status");
    }
  }

  return {
    mode: job.ats_mode,
    cutoff: split.cutoff,
    filtered: split.filtered.size,
    rescued: split.rescued.size,
    considered: list.length,
  };
}
