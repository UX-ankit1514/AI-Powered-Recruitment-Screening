"use client";

import { useActionState } from "react";
import { sendMagicLink, type LoginState } from "./actions";

export function LoginForm({ next }: { next?: string }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(sendMagicLink, { status: "idle" });

  return (
    <form action={action} className="flex flex-col gap-3">
      <label htmlFor="email" className="text-[13px] font-medium text-text-2">
        Work email
      </label>
      <input
        id="email"
        name="email"
        type="email"
        required
        autoComplete="email"
        placeholder="you@company.com"
        className="h-11 rounded-[10px] border border-line-strong bg-surface px-3.5 text-[15px] outline-none focus:border-accent"
      />
      {next ? <input type="hidden" name="next" value={next} /> : null}
      <button
        type="submit"
        disabled={pending}
        className="h-11 rounded-[10px] bg-accent font-semibold text-white transition-colors hover:bg-accent-ink disabled:opacity-60"
      >
        {pending ? "Sending link" : "Email me a sign-in link"}
      </button>
      <p role="status" aria-live="polite" className={state.status === "error" ? "text-[13px] text-red" : "text-[13px] text-text-2"}>
        {state.message}
      </p>
    </form>
  );
}
