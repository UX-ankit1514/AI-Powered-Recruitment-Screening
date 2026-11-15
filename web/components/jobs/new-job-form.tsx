"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { JdField } from "./jd-field";

export function NewJobForm() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [jd, setJd] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      setError("Give the job a title.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: title.trim(), jd_text: jd }),
      });
      const body = (await res.json().catch(() => ({}))) as { job?: { id: string }; error?: string };
      if (!res.ok || !body.job) throw new Error(body.error ?? `Could not create the job (${res.status})`);
      router.push(`/jobs/${body.job.id}/setup`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the job.");
      setBusy(false);
    }
  }

  return (
    <form className="card sec" style={{ maxWidth: 760 }} onSubmit={submit} noValidate>
      <h2>The role</h2>
      <p className="hint">Start with the title and description. You set the rubric and calling rules next.</p>
      <div className="f">
        <label htmlFor="nj-title">Job title</label>
        <input id="nj-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} placeholder="e.g. Sales Executive · Bengaluru" autoFocus />
      </div>
      <div className="blk">
        <JdField value={jd} onChange={setJd} />
      </div>
      {error ? (
        <p className="err" role="alert">
          {error}
        </p>
      ) : null}
      <div className="actions" style={{ marginTop: 18 }}>
        <button className="btn" type="submit" disabled={busy}>
          {busy ? "Creating…" : "Create job and set rubric"}
        </button>
      </div>
    </form>
  );
}
