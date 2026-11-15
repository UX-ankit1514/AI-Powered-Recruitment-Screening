/**
 * Backfill scores.language_mix (bias watch) for scores that don't have it yet.
 *
 *   npx tsx scripts/backfill-language-mix.ts            # write
 *   npx tsx scripts/backfill-language-mix.ts --dry-run  # only report what would change
 *
 * Reads each score's call transcript, derives english | hinglish | other with the same heuristic the
 * app uses (lib/fairness/groups.ts), and writes it. Scores with too little candidate speech stay NULL.
 * Uses the service-role key from web/.env.local (scores are server-written only). Idempotent.
 */
import { adminClient } from "./seed";
import { languageMix } from "../lib/fairness/groups";

const PAGE = 500;

type Row = { id: string; call_id: string; company_id: string };

export async function backfillLanguageMix({ dryRun = false } = {}) {
  // language_mix is newer than the generated types; use the client untyped for these two calls.
  const db = adminClient() as unknown as import("@supabase/supabase-js").SupabaseClient;
  const counts: Record<string, number> = { english: 0, hinglish: 0, other: 0, unknown: 0 };
  let lastId = "00000000-0000-0000-0000-000000000000";
  for (;;) {
    const { data, error } = await db
      .from("scores")
      .select("id, call_id, company_id")
      .is("language_mix", null)
      .gt("id", lastId)
      .order("id")
      .limit(PAGE);
    if (error) throw error;
    const rows = (data ?? []) as Row[];
    if (!rows.length) break;
    lastId = rows[rows.length - 1].id;

    const { data: calls, error: ce } = await db
      .from("calls")
      .select("id, transcript")
      .in("id", [...new Set(rows.map((r) => r.call_id))]);
    if (ce) throw ce;
    const transcript = new Map((calls ?? []).map((c: { id: string; transcript: string | null }) => [c.id, c.transcript]));

    for (const r of rows) {
      const mix = languageMix(transcript.get(r.call_id) ?? null);
      counts[mix ?? "unknown"]++;
      if (!mix || dryRun) continue;
      const { error: ue } = await db.from("scores").update({ language_mix: mix }).eq("id", r.id).is("language_mix", null);
      if (ue) throw ue;
    }
    if (rows.length < PAGE) break;
  }
  return counts;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dryRun = process.argv.includes("--dry-run");
  backfillLanguageMix({ dryRun })
    .then((c) => {
      console.log(
        `${dryRun ? "Would set" : "Set"} language_mix: english ${c.english}, hinglish ${c.hinglish}, other ${c.other}; left empty (too little speech) ${c.unknown}`,
      );
    })
    .catch((e) => {
      console.error("Backfill failed:", e instanceof Error ? e.message : e);
      process.exit(1);
    });
}
