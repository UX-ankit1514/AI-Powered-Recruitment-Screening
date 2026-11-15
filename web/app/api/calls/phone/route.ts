import { handlePhoneCall } from "@/lib/calls/single";

export async function POST(req: Request) {
  return handlePhoneCall(req);
}
