import { getMembership } from "@/components/server/session";
import { createClient } from "@/lib/supabase/server";
import { RETENTION_BOUNDS, loadRetention } from "@/lib/retention/settings";
import { RetentionForm } from "./retention-form";

/** Settings card: how long recordings and transcripts are kept. Admins edit; everyone else reads. */
export async function RetentionSettings() {
  const me = await getMembership();
  if (!me) return null;
  const value = await loadRetention(await createClient(), me.companyId);
  return (
    <section className="card full" aria-labelledby="s-retention">
      <div className="s-head">
        <h2 id="s-retention">Data retention</h2>
        <p>Older call data is deleted automatically every night. Candidates can also ask to be erased; an admin does that from the candidate’s page.</p>
      </div>
      <RetentionForm initial={value} canEdit={me.role === "admin"} bounds={RETENTION_BOUNDS} />
    </section>
  );
}
