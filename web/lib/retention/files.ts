import "server-only";
/**
 * Deletes storage files queued by the nightly retention purge (public.purge_expired_data()).
 * Runs on the server with the service key it already has, on the every-minute dispatcher run,
 * so the database never needs a copy of that key (see migration 20261116130000).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

type Claimed = { id: number; bucket: string; path: string };

export async function flushRetentionFiles(db: SupabaseClient, limit = 100): Promise<number> {
  const { data, error } = await db.rpc("claim_retention_files", { p_limit: limit });
  if (error || !Array.isArray(data) || !data.length) return 0;
  const byBucket = new Map<string, Claimed[]>();
  for (const r of data as Claimed[]) byBucket.set(r.bucket, [...(byBucket.get(r.bucket) ?? []), r]);
  let done = 0;
  for (const [bucket, rows] of byBucket) {
    const ids = rows.map((r) => r.id);
    const { error: rmErr } = await db.storage.from(bucket).remove(rows.map((r) => r.path));
    await db.rpc("settle_retention_files", { p_ids: ids, p_error: rmErr ? "storage remove failed" : null });
    if (!rmErr) done += ids.length;
  }
  return done;
}
