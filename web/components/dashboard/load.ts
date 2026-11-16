import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Membership } from "@/components/server/session";
import { readFlags, isHiddenFit, sourceLabel, type CallSummary } from "@/components/candidate-format";
import { CustomTraitSchema, MustHaveSchema, WeightsSchema, type CustomTrait, type CallOutcome, type CallState } from "@/lib/types";
import { z } from "zod";
import { fxInrPerUsd } from "@/lib/cost";
import { latestOverrides, type OverrideInfo } from "@/components/results/model";

export type DashCandidate = {
  id: string;
  name: string;
  source: string;
  status: string;
  resumeScore: number | null;
  scored: boolean;
  qualities: Record<string, { score: number | null } | null>;
  mustHaveResults: { met: boolean | "unknown" | null; text?: string }[];
  flags: ReturnType<typeof readFlags>;
  shortExit: boolean;
  summary: string;
  call: CallSummary | null;
  /** The team's pick, when someone changed it (latest override action). */
  override: OverrideInfo | null;
};

export type LiveCall = { id: string; name: string; state: CallState; startedAt: string | null };

export type DashboardData = {
  job: { id: string; title: string; languages: string[]; atsMode: string; atsTopPct: number };
  otherOpenRoles: number;
  rubric: { version: number; weights: Record<string, number>; customTraits: CustomTrait[]; mustHaves: string[] } | null;
  candidates: DashCandidate[];
  kpi: {
    applicants: number;
    sources: { label: string; count: number }[];
    completed: number;
    shortExits: number;
    hiddenFits: { total: number; otherRole: number; culture: number; internship: number; mismatch: number; hrReview: number };
    /** Bolna call cost, summed. Bolna reports total_cost in USD cents. */
    spendCents: number;
    /** INR per USD used to show a derived rupee figure (env COST_FX_INR_PER_USD, default 88). */
    fxInrPerUsd: number;
    pipeline: { queued: number; retrying: number; onCall: number };
  };
  live: LiveCall[];
};

export type JobPick = { id: string; title: string; status: string };

/** Jobs of the user's company, newest first (RLS-scoped). */
export async function loadJobs(me: Membership): Promise<JobPick[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("jobs")
    .select("id, title, status, created_at")
    .eq("company_id", me.companyId)
    .order("created_at", { ascending: false });
  return (data ?? []).map((j) => ({ id: j.id, title: j.title, status: j.status }));
}

const uuid = z.uuid();

export async function loadDashboard(me: Membership, jobs: JobPick[], requestedJobId?: string): Promise<DashboardData | null> {
  const wanted = requestedJobId && uuid.safeParse(requestedJobId).success ? requestedJobId : undefined;
  const pick = jobs.find((j) => j.id === wanted) ?? jobs.find((j) => j.status === "open") ?? jobs[0];
  if (!pick) return null;

  const supabase = await createClient();
  const [jobRes, rubricRes, rankRes, callsRes] = await Promise.all([
    supabase.from("jobs").select("id, title, languages, ats_mode, ats_top_pct").eq("id", pick.id).maybeSingle(),
    supabase
      .from("rubrics")
      .select("version, weights, custom_traits, must_haves")
      .eq("job_id", pick.id)
      .eq("is_current", true)
      .maybeSingle(),
    supabase
      .from("candidate_ranking")
      .select("candidate_id, name, source, status, resume_only_score, score_id, qualities, must_have_results, flags, short_exit, summary")
      .eq("job_id", pick.id),
    supabase
      .from("calls")
      .select("id, candidate_id, state, outcome, duration_s, cost, attempt, started_at, created_at")
      .eq("job_id", pick.id)
      .order("created_at", { ascending: true }),
  ]);
  if (!jobRes.data) return null;
  const job = jobRes.data;

  // HR pick overrides live in the audit log (latest override action per candidate).
  const rankIds = (rankRes.data ?? []).map((r) => r.candidate_id).filter((id): id is string => Boolean(id));
  const overrideRows: { candidate_id: string; new_value: unknown; note: string | null; at: string }[] = [];
  for (let i = 0; i < rankIds.length; i += 150) {
    const { data } = await supabase.from("actions").select("candidate_id, new_value, note, at").eq("type", "override").in("candidate_id", rankIds.slice(i, i + 150));
    overrideRows.push(...(data ?? []));
  }
  const overrides = latestOverrides(overrideRows);

  // latest call per candidate (rows ordered oldest → newest, so the last write wins)
  const latestCall = new Map<string, CallSummary>();
  let spendCents = 0;
  const liveIds: { id: string; candidateId: string; state: CallState; startedAt: string | null }[] = [];
  for (const c of callsRes.data ?? []) {
    latestCall.set(c.candidate_id, {
      state: c.state,
      outcome: c.outcome as CallOutcome | null,
      durationS: c.duration_s,
      attempt: c.attempt,
    });
    const cents = Number(c.cost);
    if (c.cost !== null && Number.isFinite(cents)) spendCents += cents;
    if (c.state === "dialing" || c.state === "in_call") {
      liveIds.push({ id: c.id, candidateId: c.candidate_id, state: c.state, startedAt: c.started_at });
    }
  }

  const candidates: DashCandidate[] = (rankRes.data ?? [])
    .filter((r) => r.candidate_id)
    .map((r) => ({
      id: r.candidate_id as string,
      name: r.name ?? "Unnamed",
      source: r.source ?? "",
      status: r.status ?? "imported",
      resumeScore: typeof r.resume_only_score === "number" ? r.resume_only_score : null,
      scored: Boolean(r.score_id),
      qualities: (r.qualities && typeof r.qualities === "object" ? r.qualities : {}) as DashCandidate["qualities"],
      mustHaveResults: Array.isArray(r.must_have_results) ? (r.must_have_results as DashCandidate["mustHaveResults"]) : [],
      flags: readFlags(r.flags),
      shortExit: r.short_exit === true,
      summary: r.summary ?? "",
      call: latestCall.get(r.candidate_id as string) ?? null,
      override: overrides.get(r.candidate_id as string) ?? null,
    }));

  const sourceCounts = new Map<string, number>();
  let completed = 0;
  let shortExits = 0;
  const hf = { total: 0, otherRole: 0, culture: 0, internship: 0, mismatch: 0, hrReview: 0 };
  const pipeline = { queued: 0, retrying: 0, onCall: 0 };
  for (const c of candidates) {
    sourceCounts.set(c.source, (sourceCounts.get(c.source) ?? 0) + 1);
    const o = c.call?.outcome;
    if (o === "completed" || o === "short_exit") completed++;
    if (o === "short_exit" || c.shortExit) shortExits++;
    if (c.call && !c.call.outcome) {
      if (c.call.state === "queued") pipeline[c.call.attempt > 1 ? "retrying" : "queued"]++;
      else if (c.call.state === "dialing" || c.call.state === "in_call") pipeline.onCall++;
    }
    const f = c.flags;
    if (isHiddenFit(f)) hf.total++;
    if (f.otherRole) hf.otherRole++;
    if (f.cultureStandout) hf.culture++;
    if (f.wantsInternship) hf.internship++;
    if (f.resumeMismatch > 0) hf.mismatch++;
    if (f.hrReview) hf.hrReview++;
  }

  const names = new Map(candidates.map((c) => [c.id, c.name]));
  const live: LiveCall[] = liveIds.map((l) => ({
    id: l.id,
    name: names.get(l.candidateId) ?? "Candidate",
    state: l.state,
    startedAt: l.startedAt,
  }));

  const weights = WeightsSchema.safeParse(rubricRes.data?.weights);
  const traits = z.array(CustomTraitSchema).safeParse(rubricRes.data?.custom_traits);
  const mh = z.array(MustHaveSchema).safeParse(rubricRes.data?.must_haves);

  return {
    job: {
      id: job.id,
      title: job.title,
      languages: job.languages,
      atsMode: job.ats_mode,
      atsTopPct: job.ats_top_pct,
    },
    otherOpenRoles: jobs.filter((j) => j.id !== job.id && j.status === "open").length,
    rubric: rubricRes.data
      ? {
          version: rubricRes.data.version,
          weights: weights.success ? weights.data : {},
          customTraits: traits.success ? traits.data : [],
          mustHaves: mh.success ? mh.data.map((m) => m.text) : [],
        }
      : null,
    candidates,
    kpi: {
      applicants: candidates.length,
      sources: [...sourceCounts.entries()]
        .map(([s, count]) => ({ label: sourceLabel(s), count }))
        .sort((a, b) => b.count - a.count),
      completed,
      shortExits,
      hiddenFits: hf,
      spendCents,
      fxInrPerUsd: fxInrPerUsd(),
      pipeline,
    },
    live,
  };
}
