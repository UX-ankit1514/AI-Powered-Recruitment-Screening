import { NextResponse } from "next/server";
import { z } from "zod";
import { draftRubric, AiError } from "@/lib/ai";
import { authorizeJob, jsonError, readJson, zodMessage } from "../../../_lib/auth";

export const maxDuration = 60;

/** Optional unsaved edits from the setup screen; otherwise the saved job is used. */
const DraftInput = z
  .object({
    jd_text: z.string().max(20_000).optional(),
    culture_values: z.array(z.object({ name: z.string().max(80), description: z.string().max(300).optional() })).max(5).optional(),
  })
  .strict();

/** POST /api/jobs/:id/rubric/draft — AI suggestion for must-haves and traits. Not saved. Admin/recruiter only. */
export async function POST(req: Request, ctx: RouteContext<"/api/jobs/[id]/rubric/draft">) {
  const { id } = await ctx.params;
  const auth = await authorizeJob(id, { write: true });
  if (!auth.ok) return auth.response;

  const raw = (await readJson(req)) ?? {};
  const parsed = DraftInput.safeParse(raw);
  if (!parsed.success) return jsonError(400, zodMessage(parsed.error));

  const { data: job } = await auth.supabase.from("jobs").select("jd_text, culture_values").eq("id", auth.job.id).maybeSingle();
  const jd = (parsed.data.jd_text ?? job?.jd_text ?? "").trim();
  if (!jd) return jsonError(400, "Add the job description first");
  const values = parsed.data.culture_values ?? (Array.isArray(job?.culture_values) ? (job.culture_values as { name: string }[]) : []);

  try {
    const draft = await draftRubric(jd, values);
    return NextResponse.json({
      must_haves: draft.must_haves,
      nice_to_haves: draft.nice_to_haves,
      suggested_traits: draft.suggested_traits,
    });
  } catch (err) {
    if (err instanceof AiError && err.kind === "config") return jsonError(503, "AI drafting is not configured on this server");
    return jsonError(502, "The AI could not draft a rubric right now. Try again in a minute.");
  }
}
