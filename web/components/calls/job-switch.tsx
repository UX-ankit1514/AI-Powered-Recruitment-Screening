"use client";

import { useRouter } from "next/navigation";

export function JobSwitch({ jobs, current }: { jobs: { id: string; title: string; status: string }[]; current: string }) {
  const router = useRouter();
  if (jobs.length < 2) return null;
  return (
    <label className="rs-jobpick" style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--color-text-3)" }}>
      Job
      <select
        value={current}
        onChange={(e) => router.push(`/calls?job=${e.target.value}`)}
        aria-label="Calls for job"
        style={{ width: "auto", padding: "6px 30px 6px 10px", fontWeight: 600, fontSize: 13 }}
      >
        {jobs.map((j) => (
          <option key={j.id} value={j.id}>
            {j.title}
            {j.status === "closed" ? " (closed)" : ""}
          </option>
        ))}
      </select>
    </label>
  );
}
