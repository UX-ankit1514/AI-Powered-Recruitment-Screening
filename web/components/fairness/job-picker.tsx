"use client";

import { useRouter } from "next/navigation";

export function FairnessJobPicker({ jobs, current }: { jobs: { id: string; title: string; status: string }[]; current: string }) {
  const router = useRouter();
  if (jobs.length < 2) return null;
  return (
    <label className="fw-jobpick">
      Job
      <select value={current} onChange={(e) => router.push(`/fairness?job=${e.target.value}`)} aria-label="Fairness for job">
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
