/** M6 runtime config. Server only; values come from env at call time (tests can change them). */

/** The app interviewer agent (bolna/app-agent-id.txt). Never the demo agent. */
export const APP_AGENT_ID = "e155c924-5640-467a-b216-1bb44240497e";
export const DEMO_AGENT_ID = "dbec7633-7b93-49e5-bca5-5636bd047ae4";
export const BOLNA_BASE = "https://api.bolna.ai";

/** Bolna's webhook / function source IPs (bolna/app-agent.md §4). */
export const BOLNA_IPS = ["13.203.39.153", "13.126.9.249", "13.202.133.53"];

/** Only real Indian mobile numbers may ever be dialled. */
export const DIALABLE_PHONE = /^\+91[6-9]\d{9}$/;

export const MAX_ATTEMPTS = 3;
export const MAX_RESCHEDULES = 2;
export const RETRY_DELAY_MIN = 30;

export function agentId(): string {
  const fromEnv = process.env.BOLNA_APP_AGENT_ID?.trim();
  const id = fromEnv || APP_AGENT_ID;
  if (id === DEMO_AGENT_ID) throw new Error("Refusing to use the demo Bolna agent from the app");
  return id;
}

/** Safety lock: phone calls are placed only when this is exactly "true". */
export function dispatchEnabled(): boolean {
  return process.env.DISPATCH_ENABLED === "true";
}

export function bolnaKey(): string | null {
  return process.env.BOLNA_API_KEY?.trim() || null;
}

export function appBaseUrl(fallbackOrigin?: string): string | null {
  const env = process.env.APP_BASE_URL?.trim();
  if (env && !/localhost|127\.0\.0\.1/.test(env)) return env.replace(/\/$/, "");
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  return (env || fallbackOrigin || null)?.replace(/\/$/, "") ?? null;
}
