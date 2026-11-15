import { bookPickTime } from "./pick-time";
import { ipKey } from "./rate-limit";

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function handlePickTimeBook(req: Request): Promise<Response> {
  const b = (await req.json().catch(() => null)) as { token?: unknown; slot?: unknown } | null;
  if (!b || typeof b !== "object") return json({ error: "Pick one of the times shown." }, 400);
  const r = await bookPickTime(b.token, b.slot, ipKey(req));
  return r.ok ? json({ booked: true, spoken: r.spoken, changes_left: r.changesLeft }) : json({ error: r.error }, r.status);
}
