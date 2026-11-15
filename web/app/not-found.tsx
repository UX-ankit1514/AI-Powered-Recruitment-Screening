import Link from "next/link";

export default function NotFound() {
  return (
    <main className="grid min-h-screen place-items-center px-4 text-center">
      <div>
        <h1 className="text-[26px] font-semibold tracking-tight">Page not found</h1>
        <Link href="/dashboard" className="mt-3 inline-block text-accent underline-offset-2 hover:underline">
          Back to dashboard
        </Link>
      </div>
    </main>
  );
}
