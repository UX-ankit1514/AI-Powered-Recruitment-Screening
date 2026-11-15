import { handleDispatch } from "@/lib/calls/dispatch";

export const maxDuration = 120;

export async function POST(req: Request) {
  return handleDispatch(req);
}
