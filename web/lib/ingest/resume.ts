/**
 * Bridge to M3's resume reader (/web/lib/ai). Loaded lazily; a missing export or any
 * failure (no AI key, timeout, bad output) is tolerated: import still succeeds and the
 * candidate simply has no resume score yet.
 */
import { z } from "zod";
import type { Json } from "../database.types";
import type { DB } from "./http";

export type ResumeContext = {
  role: string;
  company?: string;
  jd_text?: string;
  must_haves?: string[];
  nice_to_haves?: string[];
};

export type ResumeReading = {
  profile: Record<string, unknown>;
  resume_only_score: number | null;
  resume_note: string | null;
  resume_questions: string[];
};

type ReadResumeFn = (...args: unknown[]) => Promise<unknown>;

const ReadingSchema = z
  .object({
    profile: z.record(z.string(), z.unknown()).nullish(),
    resume_only_score: z.union([z.number(), z.string()]).nullish(),
    resume_note: z.string().nullish(),
    resume_questions: z.array(z.string()).nullish(),
  })
  .passthrough();

let cached: Promise<ReadResumeFn | null> | null = null;

/** Override hook for tests (pass null to simulate "M3 not built"). */
export function __setResumeReader(fn: ReadResumeFn | null | undefined) {
  cached = fn === undefined ? null : Promise.resolve(fn);
}

async function loadReader(): Promise<ReadResumeFn | null> {
  if (!cached) {
    // lib/ai (M3) now exists; a missing export or load failure still degrades to "no reader".
    cached = import("../ai/index")
      .then((m: Record<string, unknown>) => {
        const fn = m.readResume ?? (m.default as Record<string, unknown> | undefined)?.readResume;
        return typeof fn === "function" ? (fn as ReadResumeFn) : null;
      })
      .catch(() => null);
  }
  return cached;
}

export async function resumeReaderAvailable() {
  return (await loadReader()) !== null;
}

/**
 * Calls M3's readResume(text, rubric, role, company) (lib/ai/read-resume.ts).
 * Returns null when unavailable or on any failure (bad key, timeout, schema).
 */
export async function readResumeSafe(text: string, ctx: ResumeContext): Promise<ResumeReading | null> {
  const fn = await loadReader();
  if (!fn || text.trim().length < 40) return null;
  try {
    const rubric = {
      must_haves: (ctx.must_haves ?? []).map((t) => ({ text: t })),
      nice_to_haves: (ctx.nice_to_haves ?? []).map((t) => ({ text: t })),
    };
    const out = await fn(text.slice(0, 20_000), rubric, ctx.role, ctx.company ?? "");
    const r = ReadingSchema.safeParse(out);
    if (!r.success) return null;
    const n = Math.round(Number(r.data.resume_only_score));
    return {
      profile: r.data.profile ?? {},
      resume_only_score: r.data.resume_only_score != null && Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : null,
      resume_note: r.data.resume_note?.trim().slice(0, 500) || null,
      resume_questions: (r.data.resume_questions ?? []).filter((q) => q.trim()).slice(0, 2),
    };
  } catch {
    return null;
  }
}

/** Runs `fn` over items with at most `limit` in flight. */
export async function mapLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) await fn(items[i++]);
  });
  await Promise.all(workers);
}

export type EnrichTarget = { id: string; resume_text: string; resume_note: string | null };

/**
 * Reads each resume and writes profile / resume_only_score / resume_note.
 * The resume text and personal questions are kept inside `profile` for the call brief (M3/M6).
 */
export async function enrichCandidates(db: DB, targets: EnrichTarget[], ctx: ResumeContext) {
  if (!targets.length || !(await resumeReaderAvailable())) return 0;
  let enriched = 0;
  await mapLimit(targets, 4, async (t) => {
    const r = await readResumeSafe(t.resume_text, ctx);
    if (!r) return;
    const profile = {
      ...r.profile,
      resume_note: t.resume_note ?? r.resume_note,
      resume_questions: r.resume_questions,
      resume_text: t.resume_text.slice(0, 20_000),
    } as Json;
    const { error } = await db
      .from("candidates")
      .update({ profile, resume_only_score: r.resume_only_score })
      .eq("id", t.id);
    if (!error) enriched++;
  });
  return enriched;
}
