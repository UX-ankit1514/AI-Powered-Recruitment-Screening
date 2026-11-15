import Image from "next/image";
import { Suspense } from "react";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in · Pingo" };

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <main className="grid min-h-screen place-items-center px-4">
      <div className="w-full max-w-[380px]">
        <div className="mb-8 flex items-center gap-3">
          <Image src="/pingo-mark.svg" alt="" width={36} height={36} priority />
          <div>
            <div className="text-[20px] font-semibold leading-none tracking-tight">Pingo</div>
            <div className="mt-1 text-[12.5px] text-text-3">Every applicant gets heard</div>
          </div>
        </div>
        <div className="rounded-lg border border-line bg-surface p-6 shadow-card">
          <h1 className="mb-1 text-[22px] font-semibold tracking-tight">Sign in</h1>
          <p className="mb-5 text-text-2">We will email you a one-time link. No password needed.</p>
          <Suspense fallback={<LoginForm />}>
            <LoginBody searchParams={searchParams} />
          </Suspense>
        </div>
      </div>
    </main>
  );
}

async function LoginBody({ searchParams }: { searchParams: PageProps<"/login">["searchParams"] }) {
  const sp = await searchParams;
  const next = typeof sp.next === "string" ? sp.next : undefined;
  const error = typeof sp.error === "string" ? sp.error : undefined;
  return (
    <>
      {error ? (
        <p role="alert" className="mb-4 rounded-md bg-red-bg px-3 py-2 text-[13px] text-red">
          That link did not work or has expired. Request a new one.
        </p>
      ) : null}
      <LoginForm next={next} />
    </>
  );
}
