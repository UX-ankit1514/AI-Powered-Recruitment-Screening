import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";
import { isCrossSiteWrite } from "@/lib/security/origin";

export async function proxy(request: NextRequest) {
  // CSRF: refuse cross-site writes to cookie-authenticated routes before anything else runs.
  if (isCrossSiteWrite({ method: request.method, url: request.nextUrl.href, headers: request.headers })) {
    return NextResponse.json({ error: "Cross-site request refused" }, { status: 403, headers: { "Cache-Control": "no-store" } });
  }
  return updateSession(request);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
