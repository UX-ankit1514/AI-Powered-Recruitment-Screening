import { z } from "zod";
import { QUALITY_KEYS } from "@/lib/types";

/** Languages the voice pipeline handles today. Others are shown as "coming soon" and rejected here. */
export const ENABLED_LANGUAGES = ["en", "hinglish"] as const;

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM (24-hour)");
const text = (max: number) => z.string().trim().min(1).max(max);

export const CallingHoursInput = z
  .object({
    start: hhmm,
    end: hhmm,
    days: z.array(z.number().int().min(0).max(6)).min(1, "Pick at least one calling day").max(7),
  })
  .strict()
  .refine((h) => h.start < h.end, { message: "Calling hours must end after they start", path: ["end"] })
  .transform((h) => ({ ...h, days: [...new Set(h.days)].sort((a, b) => a - b) }));

const CultureValueInput = z.object({ name: text(80), description: z.string().trim().max(300).default("") }).strict();
const FaqInput = z.object({ question: text(300), answer: text(1000) }).strict();

const jobFields = {
  title: text(200),
  jd_text: z.string().max(20_000),
  culture_values: z.array(CultureValueInput).max(5, "Up to 5 culture values"),
  faq: z.array(FaqInput).max(20, "Up to 20 FAQ answers"),
  calling_hours: CallingHoursInput,
  languages: z
    .array(z.enum(ENABLED_LANGUAGES))
    .min(1, "Pick at least one language")
    .transform((l) => [...new Set(l)]),
  ats_mode: z.enum(["call_everyone", "ats_filter"]),
  ats_top_pct: z.number().int().min(10).max(100),
  ats_rescue: z.boolean(),
  status: z.enum(["open", "closed"]),
  concurrency_limit: z.number().int().min(1).max(50),
};

export const JobUpdateInput = z
  .object(jobFields)
  .partial()
  .strict()
  .refine((o) => Object.keys(o).length > 0, { message: "Nothing to update" });

export const JobCreateInput = z
  .object({
    title: jobFields.title,
    jd_text: jobFields.jd_text.default(""),
    calling_hours: CallingHoursInput.optional(),
  })
  .strict();

const traitKey = z.string().regex(/^[a-z][a-z0-9_]{0,39}$/, "Trait keys are lowercase letters, digits and _");
const MustHaveInput = z.object({ text: text(300) }).strict();
const CustomTraitInput = z
  .object({ key: traitKey, name: text(60), description: z.string().trim().max(300).default("") })
  .strict();

export const RubricInput = z
  .object({
    must_haves: z.array(MustHaveInput).max(20),
    nice_to_haves: z.array(MustHaveInput).max(20).default([]),
    weights: z.record(traitKey, z.number().int().min(0).max(100)),
    custom_traits: z.array(CustomTraitInput).max(10).default([]),
  })
  .strict()
  .superRefine((r, ctx) => {
    const preset = new Set<string>(QUALITY_KEYS);
    const traitKeys = r.custom_traits.map((t) => t.key);
    if (new Set(traitKeys).size !== traitKeys.length) {
      ctx.addIssue({ code: "custom", path: ["custom_traits"], message: "Two custom traits share a key" });
    }
    for (const k of traitKeys) {
      if (preset.has(k)) ctx.addIssue({ code: "custom", path: ["custom_traits"], message: `"${k}" is already a built-in quality` });
    }
    const allowed = new Set([...preset, ...traitKeys]);
    for (const k of Object.keys(r.weights)) {
      if (!allowed.has(k)) ctx.addIssue({ code: "custom", path: ["weights", k], message: `Unknown quality "${k}"` });
    }
    if (!Object.values(r.weights).some((w) => w > 0)) {
      ctx.addIssue({ code: "custom", path: ["weights"], message: "Raise at least one weight above zero" });
    }
    const mh = r.must_haves.map((m) => m.text.toLowerCase());
    if (new Set(mh).size !== mh.length) {
      ctx.addIssue({ code: "custom", path: ["must_haves"], message: "A must-have is listed twice" });
    }
  });

export type RubricInputT = z.infer<typeof RubricInput>;
