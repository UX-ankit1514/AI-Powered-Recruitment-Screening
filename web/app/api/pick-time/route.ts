import { handlePickTimeBook } from "@/lib/messaging/pick-time-route";

/** POST /api/pick-time {token, slot} — public; the signed token is the authorization. */
export async function POST(req: Request) {
  return handlePickTimeBook(req);
}
