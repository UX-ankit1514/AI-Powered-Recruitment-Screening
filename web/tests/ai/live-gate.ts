/**
 * Live-test gate: one tiny request to the AI gateway. Returns a skip reason when the gateway can't
 * serve (no key, out of budget 402, auth failure) so live suites skip cleanly instead of failing.
 */
import { AiError, chat } from "../../lib/ai/client";

let cached: Promise<string | null> | null = null;

export function liveSkipReason(): Promise<string | null> {
  cached ??= (async () => {
    // Live AI calls cost real credit (small prepaid budget): opt in explicitly.
    if (process.env.AI_LIVE_TESTS !== "1") return "live AI tests off (set AI_LIVE_TESTS=1 to run)";
    if (!process.env.AI_API_KEY) return "no AI_API_KEY";
    try {
      await chat([{ role: "user", content: "Reply with the single word ok." }], { maxTokens: 5, timeoutMs: 20_000 });
      return null;
    } catch (e) {
      if (e instanceof AiError && (e.status === 402 || e.status === 401 || e.status === 403 || e.kind === "config")) {
        return `AI gateway unavailable (${e.status ?? e.kind}); live validation pending`;
      }
      return null; // transient: let the test run and report the real error
    }
  })();
  return cached;
}
