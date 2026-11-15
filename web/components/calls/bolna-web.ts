/**
 * Tiny adapter around the Bolna Web Call SDK (loaded from the pinned CDN build on demand).
 *
 * The SDK can mint its session from `sessionUrl` (it POSTs `{ user_data }` there) or from a
 * `getSession()` callback. Our server route (M6) takes `{ candidate_id }` at the top level and
 * builds the interviewer's user_data from the database, so we use `getSession` and post exactly
 * that body. The browser never sees the Bolna key; same-origin, so the session cookie goes along
 * and the route checks who is calling:
 *   POST /api/calls/web-session?candidate_id=<uuid>   body: { candidate_id }
 */
export const BOLNA_WEB_SDK = "https://cdn.jsdelivr.net/gh/bolna-ai/web-call@v3.0.1/dist/bolna-web-call.min.js";

type Handler = (arg: unknown) => void;
export type BolnaWebCallInstance = {
  on: (event: "state-change" | "error" | "call-end", fn: Handler) => void;
  start: () => Promise<unknown> | unknown;
  stop?: () => void;
  isMuted?: () => boolean;
  mute?: (on?: boolean) => void;
  unmute?: () => void;
  setMuted?: (on: boolean) => void;
  getRunId?: () => string | null;
};
type Ctor = new (opts: { getSession: () => Promise<unknown> }) => BolnaWebCallInstance;

export class SessionError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

let loading: Promise<Ctor> | null = null;

function loadSdk(): Promise<Ctor> {
  const w = window as unknown as { BolnaWebCall?: Ctor };
  if (w.BolnaWebCall) return Promise.resolve(w.BolnaWebCall);
  if (!loading) {
    loading = new Promise<Ctor>((ok, bad) => {
      const s = document.createElement("script");
      s.src = BOLNA_WEB_SDK;
      s.async = true;
      s.crossOrigin = "anonymous";
      s.onload = () => (w.BolnaWebCall ? ok(w.BolnaWebCall) : bad(new Error("The in-browser call did not load. Try a phone call instead.")));
      s.onerror = () => {
        loading = null;
        s.remove();
        bad(new Error("Could not load the in-browser call. Check your connection and try again."));
      };
      document.head.appendChild(s);
    });
  }
  return loading;
}

export type WebState = "starting" | "connecting" | "oncall" | "ending" | "ended";

const MAP: Record<string, WebState> = {
  idle: "starting",
  connecting: "connecting",
  ringing: "connecting",
  connected: "oncall",
  active: "oncall",
  ending: "ending",
  ended: "ended",
  disconnected: "ended",
};

export type WebCallHandle = {
  stop: () => void;
  toggleMute: () => boolean;
  isMuted: () => boolean;
  runId: () => string | null;
};

export async function startWebCall(
  candidateId: string,
  on: { state: (s: WebState) => void; error: (msg: string) => void; end: (runId: string | null, reason: string | null) => void },
): Promise<WebCallHandle> {
  const Ctor = await loadSdk();
  const call = new Ctor({
    getSession: async () => {
      const res = await fetch(`/api/calls/web-session?candidate_id=${encodeURIComponent(candidateId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidate_id: candidateId }),
        cache: "no-store",
      });
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) throw new SessionError(data?.error || "Could not start the in-browser call on this server.", res.status);
      return data;
    },
  });
  let ended = false;
  let muted = false;
  const runId = () => {
    try {
      return typeof call.getRunId === "function" ? call.getRunId() : null;
    } catch {
      return null;
    }
  };
  call.on("state-change", (st) => {
    if (ended) return;
    const k = String((st as { state?: unknown } | null)?.state ?? st ?? "").toLowerCase();
    const m = MAP[k];
    if (m && m !== "ended") on.state(m);
  });
  call.on("error", (e) => {
    const msg = (e as { message?: unknown } | null)?.message;
    on.error(typeof msg === "string" && msg ? msg : "Something went wrong with the in-browser call.");
  });
  call.on("call-end", (info) => {
    if (ended) return;
    ended = true;
    const reason = (info as { reason?: unknown } | null)?.reason;
    on.end(runId(), typeof reason === "string" ? reason : null);
  });
  await call.start();
  return {
    stop: () => {
      try {
        call.stop?.();
      } catch {
        /* already stopped */
      }
    },
    isMuted: () => {
      try {
        return typeof call.isMuted === "function" ? Boolean(call.isMuted()) : muted;
      } catch {
        return muted;
      }
    },
    toggleMute: () => {
      const now = typeof call.isMuted === "function" ? Boolean(call.isMuted()) : muted;
      if (now) {
        if (typeof call.unmute === "function") call.unmute();
        else if (typeof call.setMuted === "function") call.setMuted(false);
        else call.mute?.(false);
      } else if (typeof call.mute === "function") call.mute(true);
      else call.setMuted?.(true);
      muted = !now;
      return muted;
    },
    runId,
  };
}
