import Link from "next/link";
import { initials } from "@/components/candidate-format";
import type { Callback } from "@/components/results/server/data";

const fmt = (iso: string) => {
  const d = new Date(iso);
  const day = new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "Asia/Kolkata" }).format(d);
  const time = new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" }).format(d);
  return { day, time };
};

/** Upcoming callbacks the interviewer booked with candidates (queued scheduled calls). */
export function CallbacksCard({ callbacks }: { callbacks: Callback[] }) {
  return (
    <section className="card cb" aria-labelledby="cb-title">
      <h2 id="cb-title">Callbacks booked</h2>
      <p>When a candidate asks to talk later, Aditi books a time and Pingo calls back then. Times are India time.</p>
      {callbacks.length ? (
        callbacks.map((c) => {
          const t = fmt(c.due_at);
          return (
            <Link key={c.id} className="cb-row" href={`/candidates/${c.candidate_id}`}>
              <div className="who">
                <span className="av" aria-hidden="true">
                  {initials(c.name)}
                </span>
                <div>
                  <div className="nm">{c.name}</div>
                  <div className="src">
                    {c.job_title}
                    {c.reschedule_count > 1 ? " · second reschedule" : ""}
                  </div>
                </div>
              </div>
              <div className="cb-when">
                <b>{t.time}</b>
                {t.day}
              </div>
            </Link>
          );
        })
      ) : (
        <p className="empty" style={{ padding: "12px 0 14px", borderTop: "1px solid var(--color-line)", margin: 0 }}>
          No callbacks booked right now.
        </p>
      )}
    </section>
  );
}
