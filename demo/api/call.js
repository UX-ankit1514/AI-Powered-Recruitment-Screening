function passcodeOk(given) {
  const expected = process.env.DEMO_PASSCODE;
  return typeof expected === "string" && expected.length > 0 && given === expected;
}

function normalisePhone(raw) {
  let p = String(raw ?? "").replace(/[\s\-()]/g, "");
  if (/^\d{10}$/.test(p)) p = "+91" + p;
  return /^\+[1-9]\d{9,14}$/.test(p) ? p : null;
}

function clip(v, max) {
  return String(v ?? "").trim().slice(0, max);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "method not allowed" });
  }

  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      return res.status(400).json({ error: "invalid JSON" });
    }
  }
  body = body && typeof body === "object" ? body : {};

  if (!passcodeOk(body.passcode)) {
    return res.status(401).json({ error: "invalid passcode" });
  }

  const phone = normalisePhone(body.phone);
  if (!phone) {
    return res.status(400).json({ error: "invalid phone number" });
  }

  const name = clip(body.name, 80);
  const firstName = name.split(/\s+/)[0] || "there";

  if (!process.env.BOLNA_API_KEY || !process.env.BOLNA_AGENT_ID) {
    return res.status(500).json({ error: "server not configured" });
  }

  try {
    const r = await fetch("https://api.bolna.ai/call", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.BOLNA_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        agent_id: process.env.BOLNA_AGENT_ID,
        recipient_phone_number: phone,
        user_data: {
          first_name: firstName,
          role: clip(body.role, 120),
          company: clip(body.company, 120),
          resume_note: clip(body.resume_note, 1500) || "not provided",
          must_haves: "2+ years of sales experience; comfortable speaking English",
          resume_q1: clip(body.resume_q1, 300),
          resume_q2: clip(body.resume_q2, 300),
        },
      }),
    });

    let data = null;
    try {
      data = await r.json();
    } catch {
      data = null;
    }

    if (!r.ok || !data?.execution_id) {
      const msg =
        (typeof data?.message === "string" && data.message) ||
        (typeof data?.error === "string" && data.error) ||
        (typeof data?.detail === "string" && data.detail) ||
        `Bolna request failed (${r.status})`;
      return res.status(502).json({ error: msg });
    }

    return res.status(200).json({ execution_id: data.execution_id });
  } catch {
    return res.status(502).json({ error: "could not reach Bolna" });
  }
}
