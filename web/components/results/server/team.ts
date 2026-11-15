import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Emails for teammates. Emails live in auth.users, which no client can read, so this one lookup
 * uses the service role, but ONLY for user ids the caller's own RLS-bound query already returned
 * as members of the caller's company. Nothing else is read. Falls back to no emails on error.
 */
export async function teammateEmails(userIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!userIds.length || userIds.length > 100) return out;
  try {
    const admin = createAdminClient();
    const res = await Promise.all(userIds.map((id) => admin.auth.admin.getUserById(id)));
    res.forEach((r, i) => {
      const email = r.data.user?.email;
      if (email) out.set(userIds[i], email);
    });
  } catch {
    // no service key in this environment: show "Teammate"
  }
  return out;
}
