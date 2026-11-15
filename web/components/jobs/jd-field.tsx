"use client";

import { useId, useState } from "react";
import { extractText, tidy } from "./extract-text";

export function JdField({ value, onChange, disabled }: { value: string; onChange: (v: string) => void; disabled?: boolean }) {
  const id = useId();
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    setMsg({ text: `Reading ${file.name}…` });
    try {
      const text = tidy(await extractText(file));
      if (!text) throw new Error("No text found in that file. If it is a scan, paste the text instead.");
      onChange(text.slice(0, 20_000));
      setMsg({ text: `Loaded ${file.name}. Check the text below before saving.` });
    } catch (err) {
      setMsg({ text: err instanceof Error ? err.message : "Could not read that file.", bad: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="f">
      <label htmlFor={`${id}-jd`}>Job description</label>
      <div className="jd-up">
        <label className="btn2 sm" htmlFor={`${id}-file`} aria-disabled={disabled || busy} style={disabled || busy ? { opacity: 0.45, cursor: "not-allowed" } : undefined}>
          {busy ? "Reading…" : "Upload JD (PDF, Word or text)"}
        </label>
        <input id={`${id}-file`} type="file" accept=".pdf,.docx,.txt,.md" hidden onChange={onFile} disabled={disabled || busy} />
        {msg ? (
          <span role="status" className="label" style={msg.bad ? { color: "var(--color-red)" } : undefined}>
            {msg.text}
          </span>
        ) : null}
      </div>
      <textarea
        id={`${id}-jd`}
        rows={10}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        maxLength={20_000}
        placeholder="Paste the job description, or upload it above."
      />
    </div>
  );
}
