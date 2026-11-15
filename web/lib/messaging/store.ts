/**
 * Records + sends one message (service role). The row is inserted first as "queued", which is
 * also how a heads-up is claimed exactly once (unique index on call_id for kind = heads_up).
 * The stored body can differ from the sent body (OTP codes are stored redacted).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { activeProvider, defaultChannel, type Channel, type SendResult } from "./provider";

/** messages / phone_otps / messaging_rate_limits are not in the generated types. */
export type AnyDb = SupabaseClient;
export const untypedDb = (db: unknown) => db as AnyDb;

export type DeliverInput = {
  companyId: string;
  candidateId?: string | null;
  callId?: string | null;
  kind: "heads_up" | "otp" | "other";
  to: string;
  body: string;
  storedBody?: string;
  channel?: Channel;
};

export type DeliverResult = { id: string; status: SendResult["status"] } | { id: null; status: "duplicate" | "error" };

export async function deliver(db: AnyDb, m: DeliverInput): Promise<DeliverResult> {
  const provider = activeProvider();
  const channel = m.channel ?? defaultChannel();
  const { data: row, error } = await db
    .from("messages")
    .insert({
      company_id: m.companyId,
      candidate_id: m.candidateId ?? null,
      call_id: m.callId ?? null,
      kind: m.kind,
      channel,
      to: m.to,
      body: (m.storedBody ?? m.body).slice(0, 1600),
      status: "queued",
      provider: provider.name,
    })
    .select("id")
    .single();
  if (error || !row) return { id: null, status: error?.code === "23505" ? "duplicate" : "error" };

  const res = await provider.send({ to: m.to, body: m.body, channel });
  await db
    .from("messages")
    .update({ status: res.status, provider_ref: res.providerRef, error: res.error })
    .eq("id", row.id);
  if (!provider.live) console.info(`[messaging:log] ${m.kind} message ${row.id} logged (not sent)`);
  return { id: row.id as string, status: res.status };
}
