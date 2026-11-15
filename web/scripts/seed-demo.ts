/**
 * Demo data for Pingo (build-spec M8). Touches ONLY the seeded "Acme SaaS" company.
 *
 *   npx tsx scripts/seed-demo.ts                 seed (or re-seed) and verify
 *   npx tsx scripts/seed-demo.ts --verify-only   just run the checks
 *   npx tsx scripts/seed-demo.ts --no-verify     seed without the checks
 *
 * Needs `npm run seed` to have run first (company, users, Sales Executive job + rubric).
 * Safe to re-run: fixed ids, demo rows are replaced, nothing outside the demo set is changed.
 *
 * Safety:
 *   - Every demo candidate has a +1555… phone (fictional range; the dispatcher only dials +91 mobiles).
 *   - Every demo call is written already finished, so nothing is queued for the dispatcher.
 *   - Demo rows carry candidates.profile.demo = true; scripts/clear-demo.ts deletes exactly those.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "../lib/database.types";
import { adminClient, SEED } from "./seed";
import { verifyQuotes } from "../lib/ai/verify-quotes";
import { normaliseText } from "../lib/ai/text";
import { computeOverall, pickFor, PICK_LABELS } from "../lib/ai/scoring-math";
import { computeAtsSplit } from "../lib/ingest/ats";
import { DEMO_CANDIDATES, NE, QUALITY_ORDER, type DemoCandidate, type JobKey } from "../fixtures/demo-candidates";

type DB = SupabaseClient<Database>;

export const DEMO = {
  companyId: SEED.acme.id,
  salesJobId: SEED.acmeJobId,
  sdeJobId: "00000000-0000-4000-8000-00000000a102",
  phonePrefix: "+1555",
} as const;

const JOB_ID: Record<JobKey, string> = { sales: DEMO.salesJobId, sde: DEMO.sdeJobId };
const JOB_TITLE: Record<JobKey, string> = { sales: "Sales Executive", sde: "Software Engineer (SDE 1)" };

// ---------------------------------------------------------------------------
// Software Engineer (SDE 1) job (JD: ~/Desktop/Software-Engineer-JD.txt)
// ---------------------------------------------------------------------------
const SDE_JD = `Software Engineer (Full-stack) – SDE 1
Acme SaaS · Bengaluru (Hybrid: 3 days a week in our Indiranagar office) · Full-time

About us
Acme SaaS builds workflow software that helps mid-market sales teams track leads, follow up on time and close faster. We're a 60-person team shipping to thousands of daily users across India.

The role
You'll build and ship product features end to end: from talking to users and writing the API, to the screen they click on. You'll join a small team of 6 engineers, own real features from week two, and see your work in customers' hands every sprint.

What you'll do
- Build features across our web app (React / Next.js) and backend APIs (Node.js or Python)
- Design simple, reliable database models in Postgres
- Write tests and review teammates' code
- Debug production issues calmly and write up what you learned
- Work with design and sales to understand what customers actually need
- Use AI coding tools sensibly to move faster without cutting corners

Must-haves
- At least 1 year building software professionally, or equivalent strong projects or internships
- Solid in JavaScript/TypeScript or Python
- Has built and shipped at least one real web app (work, side project or hackathon)
- Comfortable explaining your technical decisions in English
- Based in Bengaluru or willing to relocate

Nice to have
- Experience with React/Next.js, Node.js and Postgres
- Has worked with cloud platforms (Vercel, AWS or GCP)
- Has built something with LLM APIs or voice/AI tools
- Open-source contributions or a GitHub profile you're proud of

Who does well here
- Ownership: you ship things end to end and follow them into production
- Curiosity: you dig into why something broke, not just how to patch it
- Customer first: you care whether the feature actually helped someone

What we offer
- Competitive salary plus ESOPs
- A modern laptop and a learning budget for courses and conferences
- Health insurance for you and your family
- Mentorship from senior engineers and a clear path to SDE 2

How hiring works
Every applicant gets a short, friendly 10-minute call with Aditi, our AI interviewer, to hear about what you've built, not just read your resume. Shortlisted candidates then do one practical technical round and meet the team.`;

const SDE_VALUES = [
  { name: "Ownership", description: "Ships things end to end and follows them into production." },
  { name: "Curiosity", description: "Digs into why something broke, not just how to patch it." },
  { name: "Customer first", description: "Cares whether the feature actually helped someone." },
];
const SDE_FAQ = [
  { question: "Is the role remote?", answer: "Hybrid: three days a week in our Indiranagar office." },
  { question: "What does the stack look like?", answer: "React / Next.js on the web, Node.js or Python APIs, Postgres." },
  { question: "What happens after this call?", answer: "Shortlisted candidates do one practical technical round and meet the team." },
];
const SDE_NICE = [
  { text: "Experience with React/Next.js, Node.js and Postgres" },
  { text: "Has worked with cloud platforms (Vercel, AWS or GCP)" },
  { text: "Has built something with LLM APIs or voice/AI tools" },
  { text: "Open-source contributions or a GitHub profile" },
];

const MUST_HAVES: Record<JobKey, string[]> = {
  sales: ["Fluent spoken English and Hindi", "Based in or relocating to Bengaluru", "At least 1 year in a customer-facing role"],
  sde: [
    "At least 1 year building software professionally, or equivalent strong projects or internships",
    "Solid in JavaScript/TypeScript or Python",
    "Has built and shipped at least one real web app",
    "Comfortable explaining technical decisions in English",
    "Based in Bengaluru or willing to relocate",
  ],
};
const BALANCED = { skills: 30, experience: 30, culture_fit: 25, confidence: 15 };

// ---------------------------------------------------------------------------
// Transcripts (Bolna format: "assistant: … / user: …")
// ---------------------------------------------------------------------------
const ASK: Record<JobKey, Record<string, string>> = {
  sales: {
    experience: "Tell me about the sales work you've done so far.",
    skills: "Let's try a quick role-play. I'm a prospect who went quiet after your demo, and I've just said it's too expensive. Go ahead.",
    confidence: "What would you say to someone who thinks you're not the obvious fit for this role?",
    culture_fit: "Tell me about a time you went beyond the job for a customer or a teammate.",
    storytelling: "Tell me about a sale you're proud of.",
    learning_drive: "What are you learning at the moment, and how?",
    curiosity: "Before we wrap up, what would you like to know about Acme or this role?",
  },
  sde: {
    experience: "Tell me about where you've worked or what you've built so far.",
    skills: "Walk me through something you built recently. What was the hardest technical part?",
    confidence: "How do you handle it when a senior engineer disagrees with your approach?",
    culture_fit: "Tell me about a time something you shipped didn't work for the user. What did you do?",
    storytelling: "Tell me about a bug you're proud of fixing.",
    learning_drive: "What are you learning at the moment?",
    curiosity: "Before we wrap up, what would you like to know about the team or how we build?",
  },
};
const MH_ASK: Record<JobKey, string[]> = {
  sales: [
    "Quick check: are you comfortable speaking with customers in both English and Hindi?",
    "And are you based in Bengaluru, or open to relocating?",
    "How long have you worked in a customer-facing role?",
  ],
  sde: [
    "How long have you been building software, at work or in projects?",
    "Which languages are you most comfortable in?",
    "Have you shipped a real web app that people use?",
    "You'll explain your technical decisions in English here. Is that comfortable for you?",
    "Are you based in Bengaluru, or willing to relocate?",
  ],
};
const ORDER = ["experience", "skills", "confidence", "culture_fit", "storytelling", "learning_drive", "curiosity"] as const;

function firstName(name: string) {
  return name.split(/\s+/)[0];
}

function buildTranscript(c: DemoCandidate): string {
  if (c.transcript !== undefined) return c.transcript;
  const fn = firstName(c.name);
  const lines: string[] = [
    `assistant: Hi, am I speaking with ${fn}?`,
    "user: Yes, speaking.",
    `assistant: Hi ${fn}, I'm Aditi, calling from Acme SaaS about your application for the ${JOB_TITLE[c.job]} role. It's a short ten-minute chat. Is now a good time?`,
    "user: Yes, now is fine.",
  ];
  const quals = new Map(QUALITY_ORDER.map((k, i) => [k, c.qualities?.[i]]));
  const say = (key: string) => {
    const qv = quals.get(key as (typeof QUALITY_ORDER)[number]);
    const quotes = qv ? (qv.slice(2) as string[]) : [];
    if (!quotes.length) return;
    lines.push(`assistant: ${ASK[c.job][key]}`, `user: ${quotes.join(" ")}`);
  };
  say("experience");
  (c.mustHaves ?? []).forEach(([, quote], i) => lines.push(`assistant: ${MH_ASK[c.job][i]}`, `user: ${quote}`));
  for (const key of ORDER.slice(1)) say(key);
  for (const [a, u] of c.extra ?? []) lines.push(`assistant: ${a}`, `user: ${u}`);
  if (!c.shortExit) {
    lines.push(
      `assistant: That's everything from my side. Thank you, ${fn}. The team will get back to you within a few days.`,
      "user: Thank you, bye.",
    );
  } else {
    lines.push(`assistant: Thank you for your time, ${fn}. Take care. Bye.`);
  }
  return lines.join("\n");
}

/** Seconds into the call where a quote is said (proportional to transcript position). */
function tsOf(transcript: string, duration: number, quote: string): number | null {
  const lines = transcript.split("\n");
  const total = transcript.length || 1;
  let pos = 0;
  const nq = normaliseText(quote);
  for (const line of lines) {
    if (line.startsWith("user:") && normaliseText(line).includes(nq)) return Math.round((pos / total) * duration);
    pos += line.length + 1;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
/** The demo's own hash, so the ported 12 keep their demo source and call length. */
function demoHash(str: string) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}
const DEMO_SOURCES = ["naukri", "linkedin", "csv", "form"];

const IST_MS = 330 * 60_000;
/** UTC Date for an IST wall-clock time `daysAgo` days before today (IST). Never in the future. */
function istTime(daysAgo: number, hhmm: string, now = Date.now()): Date {
  const ist = new Date(now + IST_MS);
  const [hh, mm] = hhmm.split(":").map(Number);
  let t = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate() - daysAgo, hh, mm) - IST_MS;
  while (t > now - 10 * 60_000) t -= 86_400_000; // a "today" slot that hasn't happened yet → yesterday
  return new Date(t);
}
function tomorrowIst(hhmm: string, now = Date.now()): Date {
  const ist = new Date(now + IST_MS);
  const [hh, mm] = hhmm.split(":").map(Number);
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate() + 1, hh, mm) - IST_MS);
}

const hex = (n: number, len: number) => String(n).padStart(len, "0");
const jobDigit = (j: JobKey) => (j === "sales" ? 1 : 2);
const candId = (j: JobKey, i: number) => `de000000-0000-4000-8000-1${jobDigit(j)}${hex(i, 10)}`;
const callId = (j: JobKey, i: number) => `de000000-0000-4000-8000-2${jobDigit(j)}${hex(i, 10)}`;
const scoreId = (j: JobKey, i: number) => `de000000-0000-4000-8000-3${jobDigit(j)}${hex(i, 10)}`;
const phoneOf = (j: JobKey, i: number) => `${DEMO.phonePrefix}0${jobDigit(j)}${hex(i, 5)}`; // +1555 0 j nnnnn

/** Bolna-style total_cost in USD cents (~8.4¢ per connected minute). */
function costCents(outcome: string, seconds: number): number {
  if (outcome === "no_answer" || seconds <= 0) return 0;
  return Math.round((seconds / 60) * 8.4 * 100) / 100;
}

function check<T>(res: { error: unknown; data?: T }, what: string): T | undefined {
  if (res.error) throw new Error(`${what}: ${JSON.stringify(res.error)}`);
  return res.data;
}

// ---------------------------------------------------------------------------
// Build rows (pure)
// ---------------------------------------------------------------------------
type Rows = {
  candidates: Database["public"]["Tables"]["candidates"]["Insert"][];
  calls: Database["public"]["Tables"]["calls"]["Insert"][];
  scores: Database["public"]["Tables"]["scores"]["Insert"][];
};

export function buildRows(rubricVersion: Record<JobKey, number>, now = Date.now()): Rows {
  const rows: Rows = { candidates: [], calls: [], scores: [] };
  const counters: Record<JobKey, number> = { sales: 0, sde: 0 };
  const problems: string[] = [];

  for (const c of DEMO_CANDIDATES) {
    const i = ++counters[c.job];
    const ported = c.source === undefined;
    const source = c.source ?? DEMO_SOURCES[demoHash(c.name) % DEMO_SOURCES.length];
    const duration = c.call.duration_s ?? (c.shortExit ? 242 : 400 + (demoHash(c.name) % 190));
    if (ported && c.call.duration_s !== undefined) problems.push(`${c.name}: ported story should use the demo duration`);

    const started = istTime(c.call.daysAgo, c.call.at, now);
    const ended = new Date(started.getTime() + duration * 1000);
    const created = new Date(started.getTime() - (2 * 60 + i * 7) * 60_000);
    const transcript = buildTranscript(c);
    const scored = Boolean(c.qualities);

    rows.candidates.push({
      id: candId(c.job, i),
      company_id: DEMO.companyId,
      job_id: JOB_ID[c.job],
      name: c.name,
      phone: phoneOf(c.job, i),
      email: `${c.key}@example.com`,
      source,
      profile: { name: c.name, ...c.profile, resume_note: c.resume_note, demo: true } as unknown as Json,
      resume_only_score: c.resume,
      consent_at: created.toISOString(),
      consent_source: source === "form" ? "form" : "employer_upload",
      status: c.status ?? (scored ? "scored" : "imported"),
      created_at: created.toISOString(),
    });

    rows.calls.push({
      id: callId(c.job, i),
      candidate_id: candId(c.job, i),
      job_id: JOB_ID[c.job],
      company_id: DEMO.companyId,
      attempt: 1,
      due_at: new Date(started.getTime() - 20_000).toISOString(),
      state: "finished",
      outcome: c.call.outcome,
      started_at: c.call.outcome === "no_answer" ? null : started.toISOString(),
      duration_s: duration,
      transcript: transcript || null,
      cost: costCents(c.call.outcome, duration),
      termination_reason: c.call.termination,
      callback_at: c.call.callbackTomorrowAt ? tomorrowIst(c.call.callbackTomorrowAt, now).toISOString() : null,
      scheduled: false,
      call_kind: "phone",
      created_at: new Date(started.getTime() - 20_000).toISOString(),
    });

    if (!c.qualities) continue;
    if (c.qualities.length !== QUALITY_ORDER.length) problems.push(`${c.name}: needs ${QUALITY_ORDER.length} qualities`);
    if ((c.mustHaves ?? []).length !== MUST_HAVES[c.job].length) problems.push(`${c.name}: must-have count mismatch`);

    const qualities: Record<string, { score: number | null; reason: string; quotes: { text: string; ts: number | null }[] }> = {};
    QUALITY_ORDER.forEach((k, qi) => {
      const [score, reason, ...quotes] = c.qualities![qi];
      qualities[k] = {
        score,
        reason: score === null ? NE : reason,
        quotes: quotes.map((text) => ({ text, ts: tsOf(transcript, duration, text) })),
      };
    });
    const must_have_results = MUST_HAVES[c.job].map((text, mi) => ({ text, met: c.mustHaves![mi][0], quote: c.mustHaves![mi][1] }));
    const other = c.flags?.other;
    const flags = {
      other_role: other ? { job_id: other.job ? JOB_ID[other.job] : null, title: other.title, reason: other.reason } : null,
      culture_standout: Boolean(c.flags?.culture),
      wants_internship: Boolean(c.flags?.intern),
      resume_mismatch: c.flags?.mismatch ?? [],
      hr_review: null,
    };

    // Same check the app runs on real calls: every quote must be in the candidate's own words.
    const v = verifyQuotes({ qualities, must_have_results, flags }, transcript);
    for (const k of QUALITY_ORDER) {
      if (v.qualities[k].score !== qualities[k].score || v.qualities[k].quotes.length !== qualities[k].quotes.length)
        problems.push(`${c.name}: quote for ${k} not found in transcript`);
    }
    v.must_have_results?.forEach((m, mi) => {
      if (m.met !== must_have_results[mi].met) problems.push(`${c.name}: must-have quote ${mi + 1} not found`);
    });
    if ((v.flags?.resume_mismatch?.length ?? 0) !== flags.resume_mismatch.length) problems.push(`${c.name}: mismatch quote not found`);

    rows.scores.push({
      id: scoreId(c.job, i),
      call_id: callId(c.job, i),
      candidate_id: candId(c.job, i),
      company_id: DEMO.companyId,
      rubric_version: rubricVersion[c.job],
      qualities: qualities as unknown as Json,
      must_have_results: must_have_results as unknown as Json,
      flags: flags as unknown as Json,
      summary: c.summary ?? "",
      profile_updates: null,
      short_exit: Boolean(c.shortExit),
      model_version: "demo-seed",
      prompt_version: "demo-seed",
      created_at: new Date(ended.getTime() + 25_000).toISOString(),
    });
  }

  for (const r of rows.candidates) {
    if (!r.phone.startsWith(DEMO.phonePrefix)) problems.push(`${r.name}: phone must be ${DEMO.phonePrefix}…`);
  }
  if (rows.calls.some((c) => c.state !== "finished")) problems.push("every demo call must be finished");
  if (problems.length) throw new Error(`Demo fixtures failed checks:\n  - ${problems.join("\n  - ")}`);
  return rows;
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------
async function ensureJobs(db: DB): Promise<Record<JobKey, number>> {
  const { data: company } = await db.from("companies").select("id").eq("id", DEMO.companyId).maybeSingle();
  const { data: sales } = await db.from("jobs").select("id, created_by").eq("id", DEMO.salesJobId).eq("company_id", DEMO.companyId).maybeSingle();
  if (!company || !sales) throw new Error('Acme SaaS / Sales Executive not found. Run "npm run seed" first.');

  check(
    await db.from("jobs").upsert(
      {
        id: DEMO.sdeJobId,
        company_id: DEMO.companyId,
        title: JOB_TITLE.sde,
        jd_text: SDE_JD,
        culture_values: SDE_VALUES,
        faq: SDE_FAQ,
        created_by: sales.created_by,
      },
      { onConflict: "id", ignoreDuplicates: true, defaultToNull: false },
    ),
    "SDE job",
  );
  check(
    await db.from("rubrics").upsert(
      {
        job_id: DEMO.sdeJobId,
        company_id: DEMO.companyId,
        version: 1,
        must_haves: MUST_HAVES.sde.map((text) => ({ text })),
        nice_to_haves: SDE_NICE,
        weights: BALANCED,
        is_current: true,
        created_by: sales.created_by,
      },
      { onConflict: "job_id,version", ignoreDuplicates: true, defaultToNull: false },
    ),
    "SDE rubric",
  );

  const { data: rubrics } = await db.from("rubrics").select("job_id, version").in("job_id", [DEMO.salesJobId, DEMO.sdeJobId]).eq("is_current", true);
  const v = (id: string) => rubrics?.find((r) => r.job_id === id)?.version;
  const sv = v(DEMO.salesJobId);
  const dv = v(DEMO.sdeJobId);
  if (!sv || !dv) throw new Error("Current rubric missing for a demo job.");
  return { sales: sv, sde: dv };
}

export async function seedDemo(db: DB = adminClient()) {
  const versions = await ensureJobs(db);
  const rows = buildRows(versions);
  const ids = rows.candidates.map((c) => c.id as string);

  // Remove demo candidates that are no longer in the fixture list (only demo-marked, +1555 rows).
  const { data: existing } = await db
    .from("candidates")
    .select("id")
    .eq("company_id", DEMO.companyId)
    .eq("profile->>demo", "true")
    .like("phone", `${DEMO.phonePrefix}%`);
  const stale = (existing ?? []).map((r) => r.id).filter((id) => !ids.includes(id));
  if (stale.length) check(await db.from("candidates").delete().in("id", stale).eq("company_id", DEMO.companyId), "stale demo candidates");

  check(await db.from("candidates").upsert(rows.candidates, { onConflict: "id" }), "candidates");
  // Replace demo calls (scores cascade) so a re-run never leaves duplicates.
  check(await db.from("calls").delete().in("candidate_id", ids).eq("company_id", DEMO.companyId), "old demo calls");
  check(await db.from("calls").insert(rows.calls), "calls");
  check(await db.from("scores").insert(rows.scores), "scores");

  return { candidates: rows.candidates.length, calls: rows.calls.length, scores: rows.scores.length, versions };
}

// ---------------------------------------------------------------------------
// Verify with the app's own ranking + ATS logic
// ---------------------------------------------------------------------------
export async function verifyDemo(db: DB = adminClient()) {
  const fail: string[] = [];
  const { data: rubric } = await db.from("rubrics").select("weights").eq("job_id", DEMO.salesJobId).eq("is_current", true).single();
  const { data: rank } = await db
    .from("candidate_ranking")
    .select("candidate_id, name, resume_only_score, qualities, must_have_results, short_exit, overall, pick")
    .eq("job_id", DEMO.salesJobId);
  const weights = (rubric?.weights ?? {}) as Record<string, number>;

  const table = (rank ?? [])
    .map((r) => {
      const overall = computeOverall(r.qualities as never, weights);
      const pick = pickFor(overall, { short_exit: r.short_exit, must_have_results: r.must_have_results as never });
      return { name: r.name ?? "", resume: r.resume_only_score, overall, pick, db_overall: r.overall, db_pick: r.pick };
    })
    .sort((a, b) => (b.overall ?? -1) - (a.overall ?? -1));
  console.log("\nSales Executive ranking (current rubric weights):");
  for (const r of table) {
    console.log(
      `  ${r.name.padEnd(18)} resume ${String(r.resume ?? "-").padStart(3)}  call ${String(r.overall ?? "-").padStart(3)}  ${r.pick ? PICK_LABELS[r.pick] : "not scored"}`,
    );
    // Known quirk: JS float maths vs the view's exact numeric can round an exact .5 differently (e.g. 57 vs 58).
    if (r.overall !== r.db_overall || (r.pick ?? null) !== (r.db_pick ?? null))
      console.warn(`    ! ${r.name}: app shows ${r.overall} ${r.pick}, database view says ${r.db_overall} ${r.db_pick} (rounding at .5)`);
  }
  const rahul = table.find((r) => r.name === "Rahul Verma");
  if (!rahul || rahul.overall !== 93 || rahul.pick !== "amazing") fail.push(`Rahul should be Amazing 93, got ${rahul?.overall} ${rahul?.pick}`);
  else console.log("\n✓ Rahul Verma: Amazing 93 under Balanced");

  // ATS: switch the job to top 50%, check Rahul falls below the cut, then always restore call_everyone.
  const { data: before } = await db.from("jobs").select("ats_mode, ats_top_pct, ats_rescue").eq("id", DEMO.salesJobId).single();
  try {
    check(await db.from("jobs").update({ ats_mode: "ats_filter", ats_top_pct: 50 }).eq("id", DEMO.salesJobId), "ATS on");
    const { data: job } = await db.from("jobs").select("ats_mode, ats_top_pct, ats_rescue").eq("id", DEMO.salesJobId).single();
    const { data: cands } = await db.from("candidates").select("id, name, resume_only_score").eq("job_id", DEMO.salesJobId);
    const split = computeAtsSplit(
      (cands ?? []).map((c) => ({ id: c.id, resume_only_score: c.resume_only_score == null ? null : Number(c.resume_only_score) })),
      job!,
    );
    const rahulId = cands?.find((c) => c.name === "Rahul Verma")?.id;
    const dropped = (cands ?? []).filter((c) => split.filtered.has(c.id)).map((c) => c.name);
    console.log(`ATS top 50% (cutoff ${split.cutoff}, rescue lane on): would drop ${dropped.join(", ") || "nobody"}`);
    if (!rahulId || !split.filtered.has(rahulId)) fail.push("Rahul should be ATS filtered at top 50%");
    else console.log("✓ Rahul Verma: ATS filtered at top 50%");
  } finally {
    check(
      await db.from("jobs").update({ ats_mode: "call_everyone", ats_top_pct: before?.ats_top_pct ?? 60, ats_rescue: before?.ats_rescue ?? true }).eq("id", DEMO.salesJobId),
      "ATS restore",
    );
    const { data: after } = await db.from("jobs").select("ats_mode").eq("id", DEMO.salesJobId).single();
    if (after?.ats_mode !== "call_everyone") fail.push("ATS was not restored to call_everyone");
    else console.log("✓ ATS restored to call_everyone");
  }

  // Nothing queued, nothing dialable.
  const { count: queued } = await db
    .from("calls")
    .select("id", { count: "exact", head: true })
    .eq("company_id", DEMO.companyId)
    .neq("state", "finished")
    .in("job_id", [DEMO.salesJobId, DEMO.sdeJobId]);
  const { data: demoCands } = await db.from("candidates").select("phone").eq("company_id", DEMO.companyId).eq("profile->>demo", "true");
  const dialable = (demoCands ?? []).filter((c) => !c.phone.startsWith(DEMO.phonePrefix)).length;
  if (dialable) fail.push(`${dialable} demo candidates have a non-+1555 phone`);
  console.log(`✓ ${demoCands?.length ?? 0} demo candidates, all +1555; unfinished calls on demo jobs: ${queued ?? "?"}`);

  if (fail.length) throw new Error(`Verification failed:\n  - ${fail.join("\n  - ")}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = new Set(process.argv.slice(2));
  (async () => {
    const db = adminClient();
    if (!args.has("--verify-only")) {
      const r = await seedDemo(db);
      console.log(`Demo seed OK: ${r.candidates} candidates, ${r.calls} calls, ${r.scores} scores (rubric v${r.versions.sales} / v${r.versions.sde}).`);
    }
    if (!args.has("--no-verify")) await verifyDemo(db);
  })().catch((e) => {
    console.error("Demo seed failed:", e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
