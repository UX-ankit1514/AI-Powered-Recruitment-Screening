/** Thin Bolna REST client (bolna/app-agent.md §2–§3). Server only. Never logs the key or user_data. */
import { BOLNA_BASE, agentId, bolnaKey } from "./config";
import type { BolnaExecution } from "./outcome";

export class BolnaError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

function headers(): Record<string, string> {
  const key = bolnaKey();
  if (!key) throw new BolnaError("BOLNA_API_KEY is not set", 0);
  return { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
}

async function post(path: string, body: unknown, timeoutMs = 20_000): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(`${BOLNA_BASE}${path}`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    if (e instanceof BolnaError) throw e;
    throw new BolnaError("Bolna unreachable", 0);
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new BolnaError(`Bolna ${path} failed`, res.status);
  return data;
}

/** POST /call. Returns the execution id. The caller must have passed the safety lock. */
export async function startPhoneCall(phone: string, userData: Record<string, string>): Promise<string> {
  const body: Record<string, unknown> = { agent_id: agentId(), recipient_phone_number: phone, user_data: userData };
  const from = process.env.BOLNA_FROM_NUMBER?.trim();
  if (from) body.from_phone_number = from;
  const data = (await post("/call", body)) as { execution_id?: unknown } | null;
  const id = typeof data?.execution_id === "string" ? data.execution_id : null;
  if (!id) throw new BolnaError("Bolna /call returned no execution_id", 502);
  return id;
}

export type WebSession = { run_id: string } & Record<string, unknown>;

/** POST /web-call/session. Single use, ~120 s TTL; returned to the browser unchanged. */
export async function mintWebSession(userData: Record<string, string>): Promise<WebSession> {
  const data = (await post("/web-call/session", { agent_id: agentId(), user_data: userData })) as WebSession | null;
  if (!data || typeof data.run_id !== "string") throw new BolnaError("Bolna web session returned no run_id", 502);
  return data;
}

/** GET /executions/{id}, or null when not found. */
export async function getExecution(id: string): Promise<BolnaExecution | null> {
  const res = await fetch(`${BOLNA_BASE}/executions/${encodeURIComponent(id)}`, {
    headers: headers(),
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new BolnaError("Bolna execution fetch failed", res.status);
  return (await res.json()) as BolnaExecution;
}
