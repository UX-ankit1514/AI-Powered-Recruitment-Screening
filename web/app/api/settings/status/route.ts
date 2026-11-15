import { json, requireMember } from "@/components/results/server/auth";
import { callingStatus } from "@/components/results/server/data";

/** GET /api/settings/status — read-only calling switches for any signed-in member. No secrets. */
export async function GET() {
  const me = await requireMember();
  if (me instanceof Response) return me;
  return json(callingStatus());
}
