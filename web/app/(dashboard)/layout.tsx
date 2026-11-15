import Image from "next/image";
import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getUserClaims } from "@/lib/supabase/server";

const UPCOMING = ["Job & rubric", "Candidates", "Calls", "Hidden fits", "Settings"];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen md:grid md:grid-cols-[232px_minmax(0,1fr)]">
      <aside className="flex flex-col bg-side px-3.5 pb-4 pt-5 text-side-text md:sticky md:top-0 md:h-screen">
        <Link href="/dashboard" className="flex items-center gap-2.5 px-2.5 pb-5 text-white">
          <Image src="/pingo-mark.svg" alt="" width={30} height={30} />
          <span className="flex flex-col gap-1">
            <span className="text-[19px] font-semibold leading-none tracking-tight">Pingo</span>
            <span className="text-[11.5px] leading-tight text-side-dim">Every applicant gets heard</span>
          </span>
        </Link>
        <nav aria-label="Main" className="flex flex-col gap-0.5">
          <Link href="/dashboard" aria-current="page" className="rounded-[10px] bg-[#2c2f38] px-3 py-2 font-medium text-white">
            Dashboard
          </Link>
          {UPCOMING.map((label) => (
            <span key={label} className="cursor-default rounded-[10px] px-3 py-2 font-medium text-side-dim" aria-disabled="true">
              {label}
            </span>
          ))}
        </nav>
        <div className="mt-auto hidden rounded-md bg-side-2 p-3.5 text-[13px] md:block">
          <Suspense fallback={<div className="h-10" />}>
            <AccountBox />
          </Suspense>
        </div>
      </aside>
      <main className="min-w-0 px-4 py-7 md:px-9">
        <div className="mx-auto max-w-[1360px]">
          <Suspense fallback={<p className="text-text-3">Loading</p>}>
            <RequireUser>{children}</RequireUser>
          </Suspense>
        </div>
      </main>
    </div>
  );
}

/** Server-side gate: the proxy redirects signed-out users too, but this is the check that counts. */
async function RequireUser({ children }: { children: React.ReactNode }) {
  const claims = await getUserClaims();
  if (!claims) redirect("/login");
  return <>{children}</>;
}

async function AccountBox() {
  const claims = await getUserClaims();
  const email = String(claims?.email ?? "");
  return (
    <>
      <div className="truncate text-white" title={email}>{email}</div>
      <form action="/auth/signout" method="post" className="mt-2">
        <button type="submit" className="text-side-dim underline-offset-2 hover:text-white hover:underline">
          Sign out
        </button>
      </form>
    </>
  );
}
