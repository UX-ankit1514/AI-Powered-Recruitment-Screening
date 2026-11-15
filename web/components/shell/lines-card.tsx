import { createClient } from "@/lib/supabase/server";
import { getMembership } from "@/components/server/session";
import { CallingHoursSchema } from "@/lib/types";

const DEFAULT_LINES = Number(process.env.DEFAULT_CONCURRENCY) > 0 ? Number(process.env.DEFAULT_CONCURRENCY) : 2;

/**
 * Bolna lines card (sidebar). Real numbers only: calls currently dialling or on a call,
 * out of the largest call-line limit set on an open job. RLS scopes every query to the company.
 */
export async function LinesCard() {
  const me = await getMembership();
  if (!me) return <LinesView inUse={0} lines={DEFAULT_LINES} hours={null} />;

  const supabase = await createClient();
  const [{ count }, { data: jobs }] = await Promise.all([
    supabase
      .from("calls")
      .select("id", { count: "exact", head: true })
      .eq("company_id", me.companyId)
      .in("state", ["dialing", "in_call"]),
    supabase
      .from("jobs")
      .select("concurrency_limit, calling_hours, created_at")
      .eq("company_id", me.companyId)
      .eq("status", "open")
      .order("created_at", { ascending: false }),
  ]);

  const lines = Math.max(DEFAULT_LINES, ...(jobs ?? []).map((j) => j.concurrency_limit));
  const parsedHours = CallingHoursSchema.safeParse(jobs?.[0]?.calling_hours);
  const hours = parsedHours.success ? `${parsedHours.data.start}–${parsedHours.data.end}` : null;
  return <LinesView inUse={count ?? 0} lines={lines} hours={hours} />;
}

function LinesView({ inUse, lines, hours }: { inUse: number; lines: number; hours: string | null }) {
  const pct = lines > 0 ? Math.min(100, Math.round((inUse / lines) * 100)) : 0;
  return (
    <div className="conn">
      <b>Bolna lines</b>
      <p>
        <span className="num">{inUse}</span> of <span className="num">{lines}</span> call lines in use
      </p>
      <div className="bar" role="meter" aria-label="Call lines in use" aria-valuemin={0} aria-valuemax={lines} aria-valuenow={inUse}>
        <i style={{ width: `${pct}%` }} />
      </div>
      <p>{hours ? `Calling hours ${hours} IST` : "No open job yet"}</p>
    </div>
  );
}

export function LinesCardFallback() {
  return (
    <div className="conn" aria-hidden="true">
      <b>Bolna lines</b>
      <p>Checking lines</p>
      <div className="bar">
        <i style={{ width: "0%" }} />
      </div>
      <p>&nbsp;</p>
    </div>
  );
}
