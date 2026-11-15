import { handleApply } from "../../../../lib/ingest/apply";
import { requireVerifiedPhone } from "../../../../lib/messaging/otp-gate";

export async function POST(req: Request, ctx: RouteContext<"/api/apply/[jobId]">) {
  const { jobId } = await ctx.params;
  // Messaging: require a verified-phone token from /api/apply/otp/verify (skipped when phone
  // verification is off). Reads a clone so handleApply still gets the untouched body.
  const unverified = await requireVerifiedPhone(req.clone(), jobId);
  if (unverified) return unverified;
  return handleApply(req, jobId);
}
