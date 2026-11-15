import { handleWebSession } from "@/lib/calls/single";

export const maxDuration = 60;

export async function POST(req: Request) {
  return handleWebSession(req);
}
