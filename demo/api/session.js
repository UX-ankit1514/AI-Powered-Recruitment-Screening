// Mints a Bolna Web Call session so the interviewer can talk in the browser (no phone needed).
// POST /api/session?passcode=… with {user_data:{name, role, company, resume_note, resume_q1?, resume_q2?} -> Bolna session object (incl. run_id)
import { passcodeOk, readBody } from "./_lib.js";

const cap = (v, n) => (typeof v === "string" ? v.slice(0, n) : "");

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "method not allowed" });
  // The Web Call SDK POSTs {user_data} to sessionUrl; passcode travels in the query string.
  const raw = (await readBody(req)) || {};
  const body = raw.user_data || raw;
  if (!passcodeOk(req.query?.passcode || raw.passcode)) return res.status(401).json({ error: "invalid passcode" });

  const name = cap(body.name, 80).trim() || "there";
  const user_data = {
    first_name: name.split(/\s+/)[0],
    role: cap(body.role, 80) || "Sales Executive",
    company: cap(body.company, 80) || "Acme SaaS",
    resume_note: cap(body.resume_note, 600) || "not provided",
    resume_q1: cap(body.resume_q1, 300),
    resume_q2: cap(body.resume_q2, 300),
    must_haves: "2+ years of sales experience; comfortable speaking English",
  };

  try {
    const r = await fetch("https://api.bolna.ai/web-call/session", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.BOLNA_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ agent_id: process.env.BOLNA_AGENT_ID, user_data }),
    });
    const text = await r.text();
    res.setHeader("Cache-Control", "no-store");
    return res.status(r.status).setHeader("Content-Type", "application/json").send(text);
  } catch {
    return res.status(502).json({ error: "could not start browser call" });
  }
}
