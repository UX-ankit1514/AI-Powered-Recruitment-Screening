import { json, jsonError, requireMember } from "@/components/results/server/auth";
import { loadTalentPool, POOL_FLAGS, type PoolFlag } from "@/components/results/server/data";

/** GET /api/talent-pool?flag=other_role|culture_standout|wants_internship|resume_mismatch — flagged people across the company's jobs. */
export async function GET(req: Request) {
  const me = await requireMember();
  if (me instanceof Response) return me;
  const flag = new URL(req.url).searchParams.get("flag");
  if (flag && !(POOL_FLAGS as readonly string[]).includes(flag)) return jsonError(400, `flag must be one of ${POOL_FLAGS.join(", ")}`);
  const { rows } = await loadTalentPool(me.db, me.companyId, (flag as PoolFlag) || undefined);
  return json({ rows });
}
