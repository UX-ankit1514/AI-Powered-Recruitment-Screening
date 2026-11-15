/**
 * OpenAI-compatible chat client for the AI gateway (server only).
 * POST `${AI_BASE_URL}/chat/completions`, Bearer AI_API_KEY, model CLAUDE_MODEL (default anthropic/claude-sonnet-5.5).
 * - JSON extraction from the reply (fences / prose tolerated)
 * - zod validation; ONE retry on parse/schema failure, telling the model what was wrong
 * - retry without `temperature` if the gateway answers 400 (some models reject it)
 * - per-request timeout; one retry on timeout / 429 / 5xx
 * Keys never leave the server and are never logged.
 */
import "server-only";
import type { z } from "zod";

export const DEFAULT_MODEL = "anthropic/claude-sonnet-5.5";
const DEFAULT_BASE = "https://openrouter.ai/api/v1";

export class AiError extends Error {
  constructor(
    message: string,
    readonly kind: "config" | "http" | "timeout" | "empty" | "parse" | "schema",
    readonly status?: number,
  ) {
    super(message);
    this.name = "AiError";
  }
}

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export type CallJsonOptions<S extends z.ZodTypeAny> = {
  system: string;
  user: string;
  schema: S;
  maxTokens?: number;
  /** ≤ 0.2 per build spec. */
  temperature?: number;
  timeoutMs?: number;
  model?: string;
};

export type CallJsonResult<T> = { data: T; model: string };

function config(modelOverride?: string) {
  const apiKey = process.env.AI_API_KEY || process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new AiError("AI_API_KEY is not set", "config");
  const base = (process.env.AI_BASE_URL || DEFAULT_BASE).replace(/\/+$/, "");
  const model = modelOverride || process.env.CLAUDE_MODEL || DEFAULT_MODEL;
  return { apiKey, base, model };
}

/** Pull the first JSON object out of a model reply (handles ```json fences and leading/trailing prose). */
export function extractJson(text: string): unknown {
  const t = String(text ?? "").trim();
  try {
    return JSON.parse(t);
  } catch {
    /* fall through */
  }
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(t);
  if (fence) {
    try {
      return JSON.parse(fence[1].trim());
    } catch {
      /* fall through */
    }
  }
  // Balanced-brace scan from the first "{", string-aware.
  const start = t.indexOf("{");
  if (start === -1) throw new AiError("no JSON object in reply", "parse");
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < t.length; i++) {
    const c = t[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) {
      try {
        return JSON.parse(t.slice(start, i + 1));
      } catch {
        break;
      }
    }
  }
  const end = t.lastIndexOf("}");
  try {
    return JSON.parse(t.slice(start, end + 1));
  } catch {
    throw new AiError("reply JSON did not parse", "parse");
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** One chat completion → assistant text. Handles the 400-without-temperature and transient retries. */
export async function chat(
  messages: ChatMessage[],
  opts: { maxTokens?: number; temperature?: number; timeoutMs?: number; model?: string } = {},
): Promise<{ text: string; model: string }> {
  const { apiKey, base, model } = config(opts.model);
  const temperature = Math.min(opts.temperature ?? 0.1, 0.2);
  const timeoutMs = opts.timeoutMs ?? 60_000;

  const send = async (withTemperature: boolean) => {
    const body: Record<string, unknown> = { model, max_tokens: opts.maxTokens ?? 1500, messages };
    if (withTemperature) body.temperature = temperature;
    return fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
  };

  let withTemp = true;
  let res: Response | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      res = await send(withTemp);
      if (res.status === 400 && withTemp) {
        withTemp = false;
        res = await send(false);
      }
    } catch (e) {
      const name = (e as Error)?.name;
      if (attempt === 0 && (name === "TimeoutError" || name === "AbortError" || name === "TypeError")) {
        await sleep(800);
        continue;
      }
      throw new AiError(name === "TimeoutError" ? `model request timed out after ${timeoutMs} ms` : "model request failed", name === "TimeoutError" ? "timeout" : "http");
    }
    if (res.ok) break;
    if (attempt === 0 && (res.status === 429 || res.status >= 500)) {
      await sleep(res.status === 429 ? 2000 : 800);
      continue;
    }
    break;
  }
  if (!res || !res.ok) throw new AiError(`model request failed (${res?.status ?? "no response"})`, "http", res?.status);

  const data = (await res.json().catch(() => null)) as {
    model?: string;
    choices?: { message?: { content?: unknown } }[];
  } | null;
  const content = data?.choices?.[0]?.message?.content;
  const text = Array.isArray(content)
    ? content.map((b) => (typeof (b as { text?: unknown })?.text === "string" ? (b as { text: string }).text : "")).join("")
    : content;
  if (typeof text !== "string" || !text.trim()) throw new AiError("empty model reply", "empty");
  return { text, model: typeof data?.model === "string" && data.model ? data.model : model };
}

function issuesToText(err: z.ZodError): string {
  return err.issues
    .slice(0, 8)
    .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("; ");
}

/** Chat → JSON → zod. Retries once with the validation errors fed back if the reply doesn't parse or validate. */
export async function callJson<S extends z.ZodTypeAny>(opts: CallJsonOptions<S>): Promise<CallJsonResult<z.infer<S>>> {
  const messages: ChatMessage[] = [
    { role: "system", content: opts.system },
    { role: "user", content: opts.user },
  ];
  let lastErr: AiError | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const { text, model } = await chat(messages, opts);
    let parsed: unknown;
    try {
      parsed = extractJson(text);
    } catch (e) {
      lastErr = e instanceof AiError ? e : new AiError("reply JSON did not parse", "parse");
      messages.push({ role: "assistant", content: text.slice(0, 4000) }, { role: "user", content: "That reply was not valid JSON. Return ONLY the JSON object, nothing else." });
      continue;
    }
    const result = opts.schema.safeParse(parsed);
    if (result.success) return { data: result.data, model };
    lastErr = new AiError(`reply failed schema: ${issuesToText(result.error)}`, "schema");
    messages.push(
      { role: "assistant", content: text.slice(0, 6000) },
      { role: "user", content: `That JSON did not match the required shape (${issuesToText(result.error)}). Return ONLY the corrected JSON object.` },
    );
  }
  throw lastErr ?? new AiError("model reply invalid", "schema");
}
