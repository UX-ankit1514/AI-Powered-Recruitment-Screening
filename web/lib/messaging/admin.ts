/**
 * Admin view of messaging: provider status (no secrets) + the recent message log with masked
 * phone numbers and bodies. Admins only. Reads go through the caller's RLS-bound client, and the
 * messages table's RLS also allows admins only, so the role check here and in the database agree.
 */
import { requireMember } from "@/components/results/server/auth";
import { secretConfigured } from "./crypto";
import { maskBody, maskPhone } from "./mask";
import { activeProvider, defaultChannel, otpMode, selectedProvider, type OtpMode } from "./provider";
import { untypedDb } from "./store";

export type MessagingStatus = {
  selected: string;
  selected_label: string;
  active: string;
  live: boolean;
  configured: boolean;
  channel: "sms" | "whatsapp";
  otp: OtpMode;
  link_secret: boolean;
  notices: string[];
};

export function messagingStatus(): MessagingStatus {
  const sel = selectedProvider();
  const act = activeProvider();
  const otp = otpMode();
  const notices: string[] = [];
  if (otp === "off") notices.push("Phone verification off: no SMS provider");
  if (sel.name !== "log" && !sel.configured()) notices.push(`${sel.label} is selected but not fully configured, so messages are only logged`);
  if (!act.live) notices.push("Heads-up messages are logged here, not sent to candidates");
  if (!secretConfigured()) notices.push("Time-pick links are off: the link signing secret is missing");
  return {
    selected: sel.name,
    selected_label: sel.label,
    active: act.name,
    live: act.live,
    configured: sel.configured(),
    channel: defaultChannel(),
    otp,
    link_secret: secretConfigured(),
    notices,
  };
}

export type MessageRow = {
  id: string;
  kind: string;
  channel: string;
  to: string;
  body: string;
  status: string;
  provider: string;
  created_at: string;
  candidate_id: string | null;
};

export async function loadRecentMessages(db: unknown, companyId: string, limit = 25): Promise<MessageRow[]> {
  const { data } = await untypedDb(db)
    .from("messages")
    .select("id, kind, channel, to, body, status, provider, created_at, candidate_id")
    .eq("company_id", companyId)
    .order("created_at", { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 100));
  return ((data ?? []) as MessageRow[]).map((m) => ({ ...m, to: maskPhone(m.to), body: maskBody(m.body) }));
}

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

/** GET /api/messaging/messages — admins only. */
export async function handleListMessages(req: Request): Promise<Response> {
  const me = await requireMember();
  if (me instanceof Response) return me;
  if (me.role !== "admin") return json({ error: "Only admins can see the message log" }, 403);
  const limit = Number(new URL(req.url).searchParams.get("limit") ?? 25) || 25;
  return json({ status: messagingStatus(), messages: await loadRecentMessages(me.db, me.companyId, limit) });
}
