import { handleListMessages } from "@/lib/messaging/admin";

/** GET /api/messaging/messages — provider status + recent messages (masked). Admins only. */
export async function GET(req: Request) {
  return handleListMessages(req);
}
