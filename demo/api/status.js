import { passcodeOk, score } from "./_lib.js";

const TERMINAL = new Set([
  "completed",
  "no-answer",
  "busy",
  "failed",
  "canceled",
  "stopped",
  "error",
  "balance-low",
]);

// Best-effort cache: survives only while this function instance stays warm.
const cache = new Map();

function joinTurns(arr) {
  return arr
    .map((m) => {
      if (typeof m === "string") return m;
      if (!m || typeof m !== "object") return "";
      const who = m.role || m.speaker || m.sender || "";
      const text = m.content ?? m.text ?? m.message ?? "";
      if (typeof text !== "string" || !text) return "";
      return who ? `${who}: ${text}` : text;
    })
    .filter(Boolean)
    .join("\n");
}

function findTranscript(ex) {
  if (typeof ex?.transcript === "string" && ex.transcript.trim()) return ex.transcript;
  const t = ex?.telephony_data?.transcript;
  if (typeof t === "string" && t.trim()) return t;
  for (const cand of [ex?.transcript, t, ex?.conversation, ex?.messages]) {
    if (Array.isArray(cand)) {
      const joined = joinTurns(cand);
      if (joined) return joined;
    }
  }
  return "";
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "method not allowed" });
  }
  res.setHeader("Cache-Control", "no-store");

  const q = req.query || {};
  const passcode = Array.isArray(q.passcode) ? q.passcode[0] : q.passcode;
  const id = Array.isArray(q.id) ? q.id[0] : q.id;

  if (!passcodeOk(passcode)) {
    return res.status(401).json({ error: "invalid passcode" });
  }
  if (typeof id !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(id)) {
    return res.status(400).json({ error: "invalid id" });
  }

  if (cache.has(id)) {
    return res.status(200).json(cache.get(id));
  }

  let ex;
  try {
    const r = await fetch(`https://api.bolna.ai/executions/${encodeURIComponent(id)}`, {
      headers: { Authorization: `Bearer ${process.env.BOLNA_API_KEY}` },
    });
    if (!r.ok) {
      return res.status(502).json({ error: `could not fetch call status (${r.status})` });
    }
    ex = await r.json();
  } catch {
    return res.status(502).json({ error: "could not reach Bolna" });
  }

  const status = typeof ex?.status === "string" ? ex.status : "unknown";

  // "call-disconnected" is not terminal: transcript and recording are not ready yet.
  if (!TERMINAL.has(status)) {
    return res.status(200).json({ status, done: false });
  }
  if (status !== "completed") {
    return res.status(200).json({ status, done: true });
  }

  const transcript = findTranscript(ex);
  const recording_url = ex?.telephony_data?.recording_url || ex?.recording_url || null;
  const duration_s = Number(ex?.conversation_duration || ex?.telephony_data?.duration || 0) || 0;

  try {
    if (!transcript) throw new Error("empty transcript");
    const resumeNote = ex?.context_details?.recipient_data?.resume_note || "";
    const rd = ex?.context_details?.recipient_data || {};
    const scored = await score(transcript, resumeNote && resumeNote !== "not provided" ? resumeNote : "", rd.role || "", rd.must_haves || "");
    const out = {
      status: "completed",
      done: true,
      result: { ...scored, transcript, recording_url, duration_s, resume_only_score: null },
    };
    cache.set(id, out);
    return res.status(200).json(out);
  } catch (e) {
    console.error("scoring failed:", e?.message || "unknown error");
    return res.status(200).json({
      status: "completed",
      done: true,
      result: null,
      error: "scoring failed",
      transcript,
      recording_url,
    });
  }
}
