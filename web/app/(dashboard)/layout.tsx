import Image from "next/image";
import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { getUserClaims } from "@/lib/supabase/server";
import { getMembership, ROLE_LABEL } from "@/components/server/session";
import { SidebarNav } from "@/components/shell/sidebar-nav";
import { LinesCard, LinesCardFallback } from "@/components/shell/lines-card";
import { LiveRefresh } from "@/components/shell/live-refresh";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="app">
      <nav className="side" aria-label="Main">
        <Link className="logo" href="/dashboard" aria-label="Pingo dashboard">
          <Image src="/pingo-mark.svg" alt="" width={36} height={36} priority />
          <span className="wm">
            <span className="wm-name">
              pingo
              <i className="wm-dot" />
            </span>
            <small className="tag">Every applicant gets heard</small>
          </span>
        </Link>
        <SidebarNav />
        <Suspense fallback={<LinesCardFallback />}>
          <LinesCard />
        </Suspense>
      </nav>

      <main className="main">
        <Suspense fallback={<div className="topbar" aria-hidden="true">&nbsp;</div>}>
          <TopBar />
        </Suspense>
        <div className="view">
          <Suspense fallback={<p className="muted">Loading</p>}>
            <RequireUser>{children}</RequireUser>
          </Suspense>
        </div>
      </main>
    </div>
  );
}

/** Server-side gate: the proxy redirects signed-out users too, but this is the check that counts. */
async function RequireUser({ children }: { children: React.ReactNode }) {
  await connection();
  const claims = await getUserClaims();
  if (!claims) redirect("/login");
  return <>{children}</>;
}

async function TopBar() {
  const me = await getMembership();
  const claims = me ? null : await getUserClaims();
  const email = me?.email ?? String(claims?.email ?? "");
  return (
    <header className="topbar">
      <span className="co">{me?.companyName || "No company yet"}</span>
      <div className="me">
        <span title={email}>
          {email}
          {me ? ` · ${ROLE_LABEL[me.role]}` : ""}
        </span>
        <form action="/auth/signout" method="post">
          <button type="submit" className="linkbtn">
            Sign out
          </button>
        </form>
      </div>
      {me ? <LiveRefresh companyId={me.companyId} /> : null}
    </header>
  );
}
