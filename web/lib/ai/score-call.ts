import "server-only";
import { callJson } from "./client";
import { anonymise } from "./anonymise";
import { SCORE_PROMPT_VERSION, scoreSystem, scoreUser } from "./prompts/score";
import { makeRawScoreSchema, ScoreCallResultSchema, type ScoreCallResult } from "./schemas";
import { PRESET_QUALITY_KEYS } from "./scoring-math";
import { verifyQuotes } from "./verify-quotes";
import { clip, clipWords } from "./text";
import { describeIst, roleList, textList, toIstIso, toSnakeKey, valueList, type RoleItem, type TextItem, type TraitInput } from "./inputs";

export type ScoreCallInput = {
  transcript: string;
  role: string;
  mustHaves?: TextItem[] | null;
  cultureValues?: TextItem[] | null;
  /** The company's OTHER open roles (for flags.other_role). */
  openRoles?: RoleItem[] | null;
  resumeNote?: string | null;
  customTraits?: TraitInput[] | null;
  /** Replaced with "Candidate" in transcript and resume note before the model sees them. */
  candidateName?: string | null;
  /** When the call happened (resolves "call me tomorrow at 4"). Defaults to now. */
  callTime?: Date | string | null;
  model?: string;
};

const CONDUCT_PREFIX = "Call ended for conduct:";

function normaliseCallback(raw: string | null, callTime: Date): string | null {
  if (!raw) return null;
  let s = raw.trim();
  // No offset given → the model was told to speak IST; treat it as IST.
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(s)) s = `${s.length === 16 ? `${s}:00` : s}+05:30`;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  // Must be after the call and within ~60 days to be a believable callback request.
  if (d.getTime() < callTime.getTime() - 5 * 60_000 || d.getTime() > callTime.getTime() + 60 * 86_400_000) return null;
  return toIstIso(d);
}

/** Transcript → per-quality scores with verified quotes, must-haves, flags, summary and callback request. */
export async function scoreCall(input: ScoreCallInput): Promise<ScoreCallResult> {
  const name = input.candidateName?.trim() || null;
  const transcript = anonymise(clip(input.transcript, 60_000), name);
  if (!transcript.trim()) throw new Error("transcript is empty");
  const resumeNote = input.resumeNote ? anonymise(clip(input.resumeNote, 2000), name) : null;
  const callTime = input.callTime ? new Date(input.callTime) : new Date();
  const when = Number.isNaN(callTime.getTime()) ? new Date() : callTime;

  const reserved = new Set<string>(PRESET_QUALITY_KEYS);
  const customTraits = (input.customTraits ?? [])
    .map((t) => ({ key: toSnakeKey(t.key || t.name), name: clip(t.name, 60), description: clip(t.description ?? "", 240) }))
    .filter((t, i, a) => t.key && !reserved.has(t.key) && a.findIndex((x) => x.key === t.key) === i);
  const qualityKeys = [...PRESET_QUALITY_KEYS, ...customTraits.map((t) => t.key)];
  const mustHaves = textList(input.mustHaves);
  const openRoles = roleList(input.openRoles);

  const { data, model } = await callJson({
    system: scoreSystem(qualityKeys),
    user: scoreUser({
      transcript,
      role: clip(input.role, 160) || "the advertised role",
      mustHaves,
      cultureValues: valueList(input.cultureValues),
      openRoles: openRoles.map((r) => r.title),
      customTraits,
      presetKeys: PRESET_QUALITY_KEYS,
      resumeNote,
      callTimeIst: describeIst(when),
    }),
    schema: makeRawScoreSchema(qualityKeys),
    maxTokens: 3500,
    timeoutMs: 120_000,
    model: input.model,
  });

  // Keep exactly the expected qualities, in order.
  const qualities = Object.fromEntries(
    qualityKeys.map((k) => [k, data.qualities[k] ?? { score: null, reason: "Not assessed.", quotes: [] }]),
  );
  // Must-haves aligned to the input list (the model's text can drift; its order shouldn't).
  const mhr = mustHaves.map((text, i) => {
    const byText = data.must_have_results.find((r) => r.text.trim().toLowerCase() === text.toLowerCase());
    const r = byText ?? data.must_have_results[i];
    return { text, met: r?.met ?? ("unknown" as const), quote: r?.quote ?? null };
  });
  const other = data.flags.other_role;
  const matched = other ? openRoles.find((r) => r.title.toLowerCase() === other.title.toLowerCase()) : undefined;

  const verified = verifyQuotes(
    {
      qualities,
      must_have_results: mhr,
      flags: { ...data.flags, other_role: other ? { job_id: matched?.id ?? null, title: matched?.title ?? other.title, reason: other.reason } : null },
    },
    transcript,
  );

  const conduct = data.conduct_ended;
  let summary = clipWords(data.summary.replace(/\s+/g, " "), 60);
  if (conduct && !summary.startsWith(CONDUCT_PREFIX)) summary = clipWords(`${CONDUCT_PREFIX} ${summary}`, 60);

  return ScoreCallResultSchema.parse({
    qualities: verified.qualities,
    must_have_results: verified.must_have_results,
    flags: verified.flags,
    summary,
    profile_updates: data.profile_updates && Object.keys(data.profile_updates).length ? data.profile_updates : null,
    short_exit: data.short_exit || conduct,
    conduct_ended: conduct,
    callback_requested_at: normaliseCallback(data.callback_requested_at, when),
    model_version: model,
    prompt_version: SCORE_PROMPT_VERSION,
  });
}
