import Image from "next/image";
import { headers } from "next/headers";
import { connection } from "next/server";
import { Suspense } from "react";
import { loadPickView, type PickView } from "@/lib/messaging/pick-time";
import { TimePicker } from "./time-picker";

export const metadata = { title: "Pick a call time · Pingo", robots: { index: false, follow: false }, referrer: "no-referrer" };

export default function PickTimePage({ params }: PageProps<"/pick-time/[token]">) {
  return (
    <main className="min-h-screen px-4 py-10 sm:py-16">
      <div className="mx-auto w-full max-w-[520px]">
        <div className="mb-8 flex items-center gap-3">
          <Image src="/pingo-mark.svg" alt="" width={32} height={32} priority />
          <div>
            <div className="text-[18px] font-semibold leading-none tracking-tight">Pingo</div>
            <div className="mt-1 text-[12.5px] text-text-3">Every applicant gets heard</div>
          </div>
        </div>
        <Suspense fallback={<div className="h-[420px] rounded-lg border border-line bg-surface shadow-card" />}>
          <PickBody params={params} />
        </Suspense>
      </div>
    </main>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return <div className="rounded-lg border border-line bg-surface p-6 shadow-card sm:p-7">{children}</div>;
}

function Notice({ title, body }: { title: string; body: string }) {
  return (
    <Card>
      <h1 className="mb-2 text-[22px] font-semibold tracking-tight">{title}</h1>
      <p className="text-text-2">{body}</p>
    </Card>
  );
}

async function PickBody({ params }: { params: PageProps<"/pick-time/[token]">["params"] }) {
  await connection();
  const { token } = await params;
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip")?.trim() || "unknown";
  let view: PickView;
  try {
    view = await loadPickView(token, ip);
  } catch {
    view = { kind: "invalid" };
  }

  switch (view.kind) {
    case "invalid":
      return <Notice title="This link does not work" body="Check that you opened the full link from the message. If it still fails, just wait for the call." />;
    case "expired":
      return <Notice title="This link has expired" body="Links to change the call time last three days. The hiring team will still call you." />;
    case "rate_limited":
      return <Notice title="Please wait a moment" body="Too many visits from this network. Try again in a few minutes." />;
    case "closed":
      return (
        <Notice
          title="This call can no longer be moved"
          body={`Hi ${view.firstName}, your call about the ${view.role} role at ${view.company} has already started, finished or been closed.`}
        />
      );
    case "limit":
      return (
        <Notice
          title="Your call time is set"
          body={`Hi ${view.firstName}, Aditi from ${view.company} will call you ${view.current} about the ${view.role} role. The time has already been changed twice, so it can't be changed again here.`}
        />
      );
    case "open":
      return (
        <Card>
          <h1 className="text-[24px] font-semibold leading-tight tracking-tight text-balance">Pick a time for your call</h1>
          <p className="mt-1 mb-6 text-text-2">
            Hi {view.firstName}. Aditi from {view.company}’s hiring team will call you about the {view.role} role for a 10-minute chat.
            Right now the call is set for <b className="font-semibold text-text">{view.current}</b>. Prefer another time? Pick one below (India time).
          </p>
          <TimePicker token={token} slots={view.slots} changesLeft={view.changesLeft} company={view.company} />
        </Card>
      );
  }
}
