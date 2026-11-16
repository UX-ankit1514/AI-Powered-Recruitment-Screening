import "server-only";
/**
 * Results loaders. Every query runs on the caller's RLS-bound client, so a user only ever
 * reads their own company's rows; "not visible" comes back as null and the caller turns that
 * into a 404 (never a hint that the row exists).
 */
import { z } from "zod";
import type { Db } from "./auth";
import {
  evaluate,
  latestCallMap,
  latestOverrides,
  sortRows,
  type OverrideInfo,
  type RankRow,
} from "@/components/results/model";
import { readFlags } from "@/components/candidate-format";
import { pickFor, computeOverall } from "@/lib/ai/scoring-math";
import { AgreementSchema, JdFitSchema, type JdFit } from "@/lib/ai/schemas";
import {
  CallingHoursSchema,
  CustomTraitSchema,
  MustHaveSchema,
  QUALITY_KEYS,
  QUALITY_LABELS,
  WeightsSchema,
  type CallOutcome,
  type CallState,
  type CustomTrait,
  type MemberRole,
} from "@/lib/types";

export type RubricInfo = {
  version: number;
  weights: Record<string, number>;
  customTraits: CustomTrait[];
  mustHaves: string[];
};

function readRubric(r: { version: number; weights: unknown; custom_traits: unknown; must_haves: unknown } | null): RubricInfo | null {
  if (!r) return null;
  const w = WeightsSchema.safeParse(r.weights);
  const t = z.array(CustomTraitSchema).safeParse(r.custom_traits);
  const m = z.array(MustHaveSchema).safeParse(r.must_haves);
  return {
    version: r.version,
    weights: w.success ? w.data : {},
    customTraits: t.success ? t.data : [],
    mustHaves: m.success ? m.data.map((x) => x.text) : [],
  };
}

export function qualityList(rubric: RubricInfo | null): { key: string; name: string }[] {
  return [
    ...QUALITY_KEYS.map((k) => ({ key: k as string, name: QUALITY_LABELS[k] })),
    ...(rubric?.customTraits ?? []).map((t) => ({ key: t.key, name: t.name })),
  ];
}

async function overridesFor(db: Db, ids: string[]): Promise<Map<string, OverrideInfo>> {
  const all: { candidate_id: string; new_value: unknown; note: string | null; at: string }[] = [];
  for (let i = 0; i < ids.length; i += 150) {
    const { data } = await db
      .from("actions")
      .select("candidate_id, new_value, note, at")
      .eq("type", "override")
      .in("candidate_id", ids.slice(i, i + 150));
    all.push(...(data ?? []));
  }
  return latestOverrides(all);
}

export type Ranking = {
  job: { id: string; title: string; company_id: string; status: string };
  rubric: RubricInfo | null;
  qualities: { key: string; name: string }[];
  rows: RankRow[];
};

/** Ranked rows for one job. `rubricVersion` re-ranks on an older saved rubric; `weights` on a preset. */
export async function loadRanking(
  db: Db,
  jobId: string,
  opts: { rubricVersion?: number; weights?: Record<string, number> } = {},
): Promise<Ranking | null> {
  const { data: job } = await db.from("jobs").select("id, title, company_id, status").eq("id", jobId).maybeSingle();
  if (!job) return null;

  let rq = db.from("rubrics").select("version, weights, custom_traits, must_haves").eq("job_id", jobId);
  rq = opts.rubricVersion ? rq.eq("version", opts.rubricVersion) : rq.eq("is_current", true);
  const [{ data: rubricRow }, { data: rank }, { data: calls }] = await Promise.all([
    rq.maybeSingle(),
    db
      .from("candidate_ranking")
      .select("candidate_id, job_id, name, source, status, resume_only_score, score_id, qualities, must_have_results, flags, summary, short_exit")
      .eq("job_id", jobId),
    db
      .from("calls")
      .select("candidate_id, state, outcome, duration_s, attempt, created_at")
      .eq("job_id", jobId)
      .order("created_at", { ascending: true }),
  ]);
  const rubric = readRubric(rubricRow);
  const weights = opts.weights ?? rubric?.weights ?? {};
  const list = (rank ?? []).filter((r) => r.candidate_id);
  const ids = list.map((r) => r.candidate_id as string);
  const [overrides, callMap] = [await overridesFor(db, ids), latestCallMap(calls ?? [])];

  const rows: RankRow[] = list.map((r) => {
    const id = r.candidate_id as string;
    const score = r.score_id
      ? { qualities: r.qualities, must_have_results: r.must_have_results, flags: r.flags, summary: r.summary, short_exit: r.short_exit }
      : null;
    return {
      candidate: { id, name: r.name ?? "Unnamed", source: r.source ?? "", status: r.status ?? "imported", job_id: jobId },
      status: r.status ?? "imported",
      resume_only_score: typeof r.resume_only_score === "number" ? r.resume_only_score : null,
      call: callMap.get(id) ?? null,
      ...evaluate(score, weights, overrides.get(id) ?? null),
    };
  });
  return { job, rubric, qualities: qualityList(rubric), rows: sortRows(rows) };
}

// ---------------------------------------------------------------------------
export type ProfileCall = {
  id: string;
  attempt: number;
  kind: string;
  state: CallState;
  outcome: CallOutcome | null;
  started_at: string | null;
  created_at: string;
  due_at: string;
  duration_s: number | null;
  callback_at: string | null;
  scheduled: boolean;
  termination_reason: string | null;
};

export type ProfileAction = {
  id: string;
  type: string;
  note: string | null;
  new_value: unknown;
  old_value: unknown;
  at: string;
  by_me: boolean;
};

export type Profile = {
  candidate: {
    id: string;
    name: string;
    phone: string;
    email: string | null;
    source: string;
    status: string;
    job_id: string;
    company_id: string;
    resume_only_score: number | null;
    resume_note: string | null;
    created_at: string;
  };
  job: { id: string; title: string };
  rubric: RubricInfo | null;
  qualities: { key: string; name: string }[];
  result: ReturnType<typeof evaluate>;
  score: { id: string; created_at: string; rubric_version: number; call_id: string } | null;
  calls: ProfileCall[];
  transcript: string | null;
  recording_signed_url: string | null;
  actions: ProfileAction[];
  other_jobs: { id: string; title: string }[];
  /** Multi-pass evaluation detail (null for calls scored before it existed). */
  evaluation: ProfileEvaluation | null;
};

export type ProfileEvaluation = {
  jdFit: JdFit;
  /** 0–1, from how much of the plan was covered and whether the two scoring passes agreed. */
  confidence: number | null;
  needsReview: boolean;
  /** Criteria where the two scoring passes were more than a point apart. */
  disagreements: { id: string; label: string; a: number | null; b: number | null }[];
};

function readEvaluation(
  row: { jd_fit?: unknown; confidence?: unknown; needs_review?: unknown; agreement?: unknown } | null | undefined,
  qualityNames: Map<string, string>,
): ProfileEvaluation | null {
  if (!row) return null;
  const fit = JdFitSchema.safeParse(row.jd_fit);
  if (!fit.success) return null;
  const agreement = AgreementSchema.safeParse(row.agreement);
  const reqNames = new Map(fit.data.requirements.map((r) => [r.id, r.text]));
  const conf = typeof row.confidence === "number" ? row.confidence : typeof row.confidence === "string" ? Number(row.confidence) : null;
  return {
    jdFit: fit.data,
    confidence: conf !== null && Number.isFinite(conf) ? Math.min(1, Math.max(0, conf)) : null,
    needsReview: row.needs_review === true,
    disagreements: agreement.success
      ? agreement.data.disagreements.map((d) => ({ id: d.id, label: reqNames.get(d.id) ?? qualityNames.get(d.id) ?? d.id, a: d.a, b: d.b }))
      : [],
  };
}

const RECORDING_TTL_S = 600;

/** Bolna's own https URL is used as given; a storage path ("bucket/path") gets a short-lived signed URL. */
async function recordingUrl(db: Db, raw: string | null): Promise<string | null> {
  if (!raw) return null;
  if (/^https:\/\//i.test(raw)) return raw;
  if (/^[a-z]+:/i.test(raw)) return null; // never hand the browser javascript:/data:/http: URLs
  const clean = raw.replace(/^\/+/, "");
  const slash = clean.indexOf("/");
  if (slash < 1) return null;
  const { data } = await db.storage.from(clean.slice(0, slash)).createSignedUrl(clean.slice(slash + 1), RECORDING_TTL_S);
  return data?.signedUrl ?? null;
}

export async function loadProfile(db: Db, candidateId: string, userId: string): Promise<Profile | null> {
  const { data: c } = await db
    .from("candidates")
    .select("id, name, phone, email, source, status, job_id, company_id, resume_only_score, profile, created_at")
    .eq("id", candidateId)
    .maybeSingle();
  if (!c) return null;

  const [{ data: job }, { data: rubricRow }, { data: scoreRow }, { data: calls }, { data: actions }, { data: jobs }] = await Promise.all([
    db.from("jobs").select("id, title").eq("id", c.job_id).maybeSingle(),
    db.from("rubrics").select("version, weights, custom_traits, must_haves").eq("job_id", c.job_id).eq("is_current", true).maybeSingle(),
    db
      .from("scores")
      .select("id, call_id, created_at, rubric_version, qualities, must_have_results, flags, summary, short_exit, jd_fit, confidence, needs_review, agreement")
      .eq("candidate_id", candidateId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    db
      .from("calls")
      .select(
        "id, attempt, call_kind, state, outcome, started_at, created_at, due_at, duration_s, callback_at, scheduled, termination_reason, recording_url, transcript",
      )
      .eq("candidate_id", candidateId)
      .order("created_at", { ascending: true }),
    db
      .from("actions")
      .select("id, type, note, new_value, old_value, at, user_id")
      .eq("candidate_id", candidateId)
      .order("at", { ascending: false })
      .limit(100),
    db.from("jobs").select("id, title, status").eq("company_id", c.company_id).eq("status", "open").order("created_at", { ascending: false }),
  ]);
  if (!job) return null;

  const rubric = readRubric(rubricRow);
  const overrides = latestOverrides(
    (actions ?? []).filter((a) => a.type === "override").map((a) => ({ candidate_id: candidateId, new_value: a.new_value, note: a.note, at: a.at })),
  );
  const result = evaluate(scoreRow ?? null, rubric?.weights ?? {}, overrides.get(candidateId) ?? null);

  const callRows = calls ?? [];
  const scoredCall = scoreRow ? callRows.find((x) => x.id === scoreRow.call_id) : undefined;
  const withMedia = [...callRows].reverse().find((x) => x.transcript || x.recording_url);
  const media = scoredCall && (scoredCall.transcript || scoredCall.recording_url) ? scoredCall : withMedia;

  const profile = (c.profile && typeof c.profile === "object" ? c.profile : {}) as Record<string, unknown>;
  return {
    candidate: {
      id: c.id,
      name: c.name,
      phone: c.phone,
      email: c.email,
      source: c.source,
      status: c.status,
      job_id: c.job_id,
      company_id: c.company_id,
      resume_only_score: typeof c.resume_only_score === "number" ? c.resume_only_score : null,
      resume_note: typeof profile.resume_note === "string" ? profile.resume_note : null,
      created_at: c.created_at,
    },
    job,
    rubric,
    qualities: qualityList(rubric),
    result,
    score: scoreRow
      ? { id: scoreRow.id, created_at: scoreRow.created_at, rubric_version: scoreRow.rubric_version, call_id: scoreRow.call_id }
      : null,
    calls: callRows.map((x) => ({
      id: x.id,
      attempt: x.attempt,
      kind: x.call_kind,
      state: x.state,
      outcome: x.outcome,
      started_at: x.started_at,
      created_at: x.created_at,
      due_at: x.due_at,
      duration_s: x.duration_s,
      callback_at: x.callback_at,
      scheduled: x.scheduled,
      termination_reason: x.termination_reason,
    })),
    transcript: media?.transcript ?? null,
    recording_signed_url: await recordingUrl(db, media?.recording_url ?? null),
    actions: (actions ?? []).map((a) => ({
      id: a.id,
      type: a.type,
      note: a.note,
      new_value: a.new_value,
      old_value: a.old_value,
      at: a.at,
      by_me: a.user_id === userId,
    })),
    other_jobs: (jobs ?? []).filter((j) => j.id !== c.job_id).map((j) => ({ id: j.id, title: j.title })),
    evaluation: readEvaluation(scoreRow, new Map(qualityList(rubric).map((q) => [q.key, q.name]))),
  };
}

// ---------------------------------------------------------------------------
export const POOL_FLAGS = ["other_role", "culture_standout", "wants_internship", "resume_mismatch"] as const;
export type PoolFlag = (typeof POOL_FLAGS)[number];

export type PoolRow = {
  candidate: { id: string; name: string; source: string; status: string };
  job: { id: string; title: string };
  flags: PoolFlag[];
  other_role: { job_id: string | null; title: string | null; reason: string } | null;
  mismatch: { claim_quote: string; resume_line: string } | null;
  pick: string | null;
  overall: number | null;
  resume_only_score: number | null;
  summary: string;
  moved_to: { job_id: string; title: string } | null;
};

/** Flagged candidates across every job of the caller's company (RLS-scoped). */
export async function loadTalentPool(db: Db, companyId: string, flag?: PoolFlag): Promise<{ rows: PoolRow[]; jobs: { id: string; title: string; status: string }[] }> {
  const [{ data: rank }, { data: jobs }, { data: rubrics }] = await Promise.all([
    db
      .from("candidate_ranking")
      .select("candidate_id, job_id, name, source, status, resume_only_score, score_id, qualities, must_have_results, flags, summary, short_exit")
      .eq("company_id", companyId)
      .not("score_id", "is", null),
    db.from("jobs").select("id, title, status").eq("company_id", companyId).order("created_at", { ascending: false }),
    db.from("rubrics").select("job_id, weights").eq("company_id", companyId).eq("is_current", true),
  ]);
  const titles = new Map((jobs ?? []).map((j) => [j.id, j.title]));
  const weightsByJob = new Map((rubrics ?? []).map((r) => [r.job_id, WeightsSchema.safeParse(r.weights).data ?? {}]));

  const flagged = (rank ?? []).filter((r) => {
    const raw = (r.flags && typeof r.flags === "object" ? r.flags : {}) as Record<string, unknown>;
    const f = readFlags(r.flags);
    const has: Record<PoolFlag, boolean> = {
      other_role: Boolean(raw.other_role),
      culture_standout: f.cultureStandout,
      wants_internship: f.wantsInternship,
      resume_mismatch: f.resumeMismatch > 0,
    };
    return flag ? has[flag] : POOL_FLAGS.some((k) => has[k]);
  });
  const ids = flagged.map((r) => r.candidate_id as string);
  const overrides = await overridesFor(db, ids);

  const moves = new Map<string, { job_id: string; title: string }>();
  for (let i = 0; i < ids.length; i += 150) {
    const { data } = await db
      .from("actions")
      .select("candidate_id, new_value, at")
      .eq("type", "move_to_job")
      .in("candidate_id", ids.slice(i, i + 150))
      .order("at", { ascending: true });
    for (const a of data ?? []) {
      const v = (a.new_value && typeof a.new_value === "object" ? a.new_value : {}) as Record<string, unknown>;
      const jid = typeof v.target_job_id === "string" ? v.target_job_id : null;
      if (jid) moves.set(a.candidate_id, { job_id: jid, title: titles.get(jid) ?? "another job" });
    }
  }

  const rows: PoolRow[] = flagged.map((r) => {
    const id = r.candidate_id as string;
    const raw = (r.flags && typeof r.flags === "object" ? r.flags : {}) as Record<string, unknown>;
    const f = readFlags(r.flags);
    const or = raw.other_role as Record<string, unknown> | string | null | undefined;
    let otherRole: PoolRow["other_role"] = null;
    if (typeof or === "string" && or) otherRole = { job_id: null, title: or, reason: "" };
    else if (or && typeof or === "object") {
      const jid = typeof or.job_id === "string" ? or.job_id : null;
      otherRole = {
        job_id: jid && titles.has(jid) ? jid : null,
        title: (jid && titles.get(jid)) || (typeof or.title === "string" ? or.title : null) || (typeof or.role === "string" ? or.role : null),
        reason: typeof or.reason === "string" ? or.reason : "",
      };
    }
    const mm = Array.isArray(raw.resume_mismatch) ? raw.resume_mismatch[0] : null;
    const mismatch =
      typeof mm === "string"
        ? { claim_quote: mm, resume_line: "" }
        : mm && typeof mm === "object"
          ? { claim_quote: String((mm as Record<string, unknown>).claim_quote ?? ""), resume_line: String((mm as Record<string, unknown>).resume_line ?? "") }
          : null;
    const w = weightsByJob.get(r.job_id as string) ?? {};
    const overall = computeOverall(
      (r.qualities ?? {}) as Record<string, { score: number | null }>,
      w,
    );
    const scoredPick = pickFor(overall, {
      short_exit: r.short_exit === true,
      must_have_results: Array.isArray(r.must_have_results) ? (r.must_have_results as { met: boolean | "unknown" }[]) : [],
    });
    const flags: PoolFlag[] = [];
    if (otherRole) flags.push("other_role");
    if (f.cultureStandout) flags.push("culture_standout");
    if (f.wantsInternship) flags.push("wants_internship");
    if (f.resumeMismatch > 0) flags.push("resume_mismatch");
    return {
      candidate: { id, name: r.name ?? "Unnamed", source: r.source ?? "", status: r.status ?? "" },
      job: { id: r.job_id as string, title: titles.get(r.job_id as string) ?? "Job" },
      flags,
      other_role: otherRole,
      mismatch,
      pick: overrides.get(id)?.pick ?? scoredPick,
      overall,
      resume_only_score: typeof r.resume_only_score === "number" ? r.resume_only_score : null,
      summary: r.summary ?? "",
      moved_to: moves.get(id) ?? null,
    };
  });
  rows.sort((a, b) => (b.overall ?? -1) - (a.overall ?? -1) || a.candidate.name.localeCompare(b.candidate.name));
  return { rows, jobs: jobs ?? [] };
}

// ---------------------------------------------------------------------------
export type Callback = { id: string; due_at: string; candidate_id: string; name: string; job_title: string; reschedule_count: number };

/** Booked callbacks still to happen (queued scheduled calls), soonest first. */
export async function loadCallbacks(db: Db, companyId: string): Promise<Callback[]> {
  const since = new Date(Date.now() - 15 * 60_000).toISOString();
  const { data } = await db
    .from("calls")
    .select("id, due_at, candidate_id, reschedule_count, candidate:candidates!calls_candidate_id_company_id_fkey(name), job:jobs(title)")
    .eq("company_id", companyId)
    .eq("scheduled", true)
    .eq("state", "queued")
    .gte("due_at", since)
    .order("due_at", { ascending: true })
    .limit(50);
  return (data ?? []).map((r) => ({
    id: r.id,
    due_at: r.due_at,
    candidate_id: r.candidate_id,
    name: r.candidate?.name ?? "Candidate",
    job_title: r.job?.title ?? "",
    reschedule_count: r.reschedule_count,
  }));
}

// ---------------------------------------------------------------------------
export type SettingsData = {
  jobs: { id: string; title: string; status: string; lines: number; hours: { start: string; end: string; days: number[] } | null }[];
  members: { user_id: string; role: MemberRole; created_at: string }[];
};

export async function loadSettings(db: Db, companyId: string): Promise<SettingsData> {
  const [{ data: jobs }, { data: members }] = await Promise.all([
    db
      .from("jobs")
      .select("id, title, status, concurrency_limit, calling_hours, created_at")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false }),
    db.from("members").select("user_id, role, created_at").eq("company_id", companyId).order("created_at", { ascending: true }),
  ]);
  return {
    jobs: (jobs ?? []).map((j) => {
      const h = CallingHoursSchema.safeParse(j.calling_hours);
      return { id: j.id, title: j.title, status: j.status, lines: j.concurrency_limit, hours: h.success ? h.data : null };
    }),
    members: members ?? [],
  };
}

/** Server-side switches, as plain facts (no secrets). DISPATCH_ENABLED must be exactly "true" (M6 safety lock). */
export function callingStatus() {
  const dispatchEnabled = process.env.DISPATCH_ENABLED === "true";
  return {
    dispatch_enabled: dispatchEnabled,
    calling_paused: !dispatchEnabled,
    message: dispatchEnabled ? "Calling is on" : "Calling is paused",
    bolna_configured: Boolean(process.env.BOLNA_API_KEY?.trim()),
  };
}
