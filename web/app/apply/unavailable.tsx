import Image from "next/image";

/** Candidate-facing "this role is not open" message. No links into the app: applicants have no account. */
export function ApplyUnavailable({ framed = true }: { framed?: boolean }) {
  const card = (
    <div className="rounded-lg border border-line bg-surface p-6 shadow-card">
      <h1 className="mb-2 text-[22px] font-semibold tracking-tight text-balance">This role is not taking applications</h1>
      <p className="text-text-2">
        The link may be old, mistyped, or the role has been filled. Ask the company that shared it for a current link.
      </p>
    </div>
  );
  if (!framed) return card;
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
        {card}
      </div>
    </main>
  );
}
