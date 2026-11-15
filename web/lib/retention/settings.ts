import "server-only";
/**
 * Per-company data retention (PRD §11). Any member may read it; only an ADMIN may change it.
 * The admin check is done here and enforced again in the database (companies trigger).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { json, jsonError, requireMember, type Db } from "@/components/results/server/auth";

export const RETENTION_BOUNDS = {
  recording_days: { min: 7, max: 365, default: 90 },
  transcript_days: { min: 30, max: 730, default: 365 },
} as const;

export type Retention = { recording_days: number; transcript_days: number };

const days = (b: { min: number; max: number }) => z.number().int().min(b.min).max(b.max);
export const RetentionBody = z.object({
  recording_days: days(RETENTION_BOUNDS.recording_days),
  transcript_days: days(RETENTION_BOUNDS.transcript_days),
});

const untyped = (db: Db) => db as unknown as SupabaseClient;

export async function loadRetention(db: Db, companyId: string): Promise<Retention> {
  const { data } = await untyped(db)
    .from("companies")
    .select("retention_recording_days, retention_transcript_days")
    .eq("id", companyId)
    .maybeSingle();
  return {
    recording_days: (data?.retention_recording_days as number | undefined) ?? RETENTION_BOUNDS.recording_days.default,
    transcript_days: (data?.retention_transcript_days as number | undefined) ?? RETENTION_BOUNDS.transcript_days.default,
  };
}

/** PUT /api/settings/retention — admin of the caller's company only. */
export async function handlePutRetention(req: Request): Promise<Response> {
  const me = await requireMember();
  if (me instanceof Response) return me;
  if (me.role !== "admin") return jsonError(403, "Only admins can change data retention");

  const body = RetentionBody.safeParse(await req.json().catch(() => null));
  if (!body.success) {
    const r = RETENTION_BOUNDS;
    return jsonError(
      400,
      `Recordings must be kept ${r.recording_days.min}–${r.recording_days.max} days and transcripts ${r.transcript_days.min}–${r.transcript_days.max} days`,
    );
  }

  const { data, error } = await untyped(me.db)
    .from("companies")
    .update({ retention_recording_days: body.data.recording_days, retention_transcript_days: body.data.transcript_days })
    .eq("id", me.companyId)
    .select("retention_recording_days, retention_transcript_days")
    .maybeSingle();
  if (error?.code === "42501") return jsonError(403, "Only admins can change data retention");
  if (error || !data) return jsonError(500, "Could not save retention settings");
  return json({ recording_days: data.retention_recording_days, transcript_days: data.retention_transcript_days });
}
