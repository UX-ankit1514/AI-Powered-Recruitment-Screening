import "server-only";
import { callJson } from "./client";
import { RUBRIC_PROMPT_VERSION, RUBRIC_SYSTEM, rubricUser } from "./prompts/rubric";
import { DraftRubricResultSchema, RawRubricSchema, type DraftRubricResult } from "./schemas";
import { PRESET_QUALITY_KEYS } from "./scoring-math";
import { clip } from "./text";
import { toSnakeKey, valueList, type TextItem } from "./inputs";

/** JD + culture values → suggested must-haves, nice-to-haves and up to 3 custom traits (not saved). */
export async function draftRubric(jdText: string, cultureValues: readonly TextItem[] | null | undefined): Promise<DraftRubricResult> {
  const jd = clip(jdText, 15_000);
  if (!jd) throw new Error("job description is empty");
  const { data, model } = await callJson({
    system: RUBRIC_SYSTEM,
    user: rubricUser({ jdText: jd, cultureValues: valueList(cultureValues) }),
    schema: RawRubricSchema,
    maxTokens: 900,
  });
  const reserved = new Set<string>(PRESET_QUALITY_KEYS);
  const seen = new Set<string>();
  const traits = data.suggested_traits
    .map((t) => ({ key: toSnakeKey(t.key || t.name), name: clip(t.name, 60), description: clip(t.description, 240) }))
    .filter((t) => t.key && t.name && !reserved.has(t.key) && !seen.has(t.key) && seen.add(t.key))
    .slice(0, 3);
  return DraftRubricResultSchema.parse({
    must_haves: data.must_haves.map((s) => clip(s, 160)).slice(0, 6),
    nice_to_haves: data.nice_to_haves.map((s) => clip(s, 160)).slice(0, 8),
    suggested_traits: traits,
    model_version: model,
    prompt_version: RUBRIC_PROMPT_VERSION,
  });
}
