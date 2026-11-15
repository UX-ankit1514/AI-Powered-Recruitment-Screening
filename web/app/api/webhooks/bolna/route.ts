import { handleBolnaWebhook } from "@/lib/calls/webhook";

// Scoring runs after the response (next/server `after`) and can take up to ~2 min.
export const maxDuration = 300;

export async function POST(req: Request) {
  return handleBolnaWebhook(req);
}
