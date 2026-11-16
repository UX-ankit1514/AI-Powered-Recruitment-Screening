import "server-only";
/**
 * Call lines per company (Bolna's concurrency limit is per account, so the cap is company-wide)
 * and the "is the scheduler alive" check for Settings.
 * Any member may read; only an ADMIN may change lines (checked here and by a database trigger).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { json, jsonError, requireMember, type Db } from "@/components/results/server/auth";
import { defaultLines } from "./config";

export const LINES_BOUNDS = { min: 1, max: 50 } as const;
export const LinesBody = z.object({ lines: z.number().int().min(LINES_BOUNDS.min).max(LINES_BOUNDS.max) });

const untyped = (db: Db) => db as unknown as SupabaseClient;

export type Lines = { lines: number; custom: boolean; default: number };

export async function loadLines(db: Db, companyId: string): Promise<Lines> {
  const { data } = await untyped(db).from("companies").select("concurrency_limit").eq("id", companyId).maybeSingle();
  const set = typeof data?.concurrency_limit === "number" ? (data.concurrency_limit as number) : null;
  return { lines: set ?? defaultLines(), custom: set !== null, default: defaultLines() };
}

/** PUT /api/settings/lines — admin of the caller's company only. Body { lines: 1-50 }. */
export async function handlePutLines(req: Request): Promise<Response> {
  const me = await requireMember();
  if (me instanceof Response) return me;
  if (me.role !== "admin") return jsonError(403, "Only admins can change call lines");
  const body = LinesBody.safeParse(await req.json().catch(() => null));
  if (!body.success) return jsonError(400, `Lines must be a whole number from ${LINES_BOUNDS.min} to ${LINES_BOUNDS.max}`);
  const { data, error } = await untyped(me.db)
    .from("companies")
    .update({ concurrency_limit: body.data.lines })
    .eq("id", me.companyId)
    .select("concurrency_limit")
    .maybeSingle();
  if (error?.code === "42501") return jsonError(403, "Only admins can change call lines");
  if (error || !data) return jsonError(500, "Could not save call lines");
  return json({ lines: data.concurrency_limit });
}

export type SchedulerStatus = { running: boolean; reason: "ok" | "not_scheduled" | "no_secret" | "stale" | "never_ran" | "unknown"; lastTick: string | null };

const STALE_MS = 3 * 60_000;

/** Reads scheduler_health() (booleans + last tick, never a secret) with the member's own client. */
export async function schedulerStatus(db: Db, now: number = Date.now()): Promise<SchedulerStatus> {
  const { data, error } = await untyped(db).rpc("scheduler_health");
  if (error || !data) return { running: false, reason: "unknown", lastTick: null };
  return readSchedulerHealth(data as Record<string, unknown>, now);
}

export function readSchedulerHealth(h: Record<string, unknown>, now: number): SchedulerStatus {
  const lastTick = typeof h.last_tick === "string" ? h.last_tick : null;
  if (!h.cron_scheduled) return { running: false, reason: "not_scheduled", lastTick };
  if (!h.secret_present || !h.url_present) return { running: false, reason: "no_secret", lastTick };
  if (!lastTick) return { running: false, reason: "never_ran", lastTick };
  if (now - Date.parse(lastTick) > STALE_MS) return { running: false, reason: "stale", lastTick };
  return { running: true, reason: "ok", lastTick };
}
