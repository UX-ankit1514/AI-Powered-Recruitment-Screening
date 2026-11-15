"use client";

import { useState } from "react";

type Slot = { iso: string; label: string };
type State = { kind: "idle" | "sending" } | { kind: "done"; spoken: string; changesLeft: number } | { kind: "error"; message: string };

export function TimePicker({ token, slots, changesLeft, company }: { token: string; slots: Slot[]; changesLeft: number; company: string }) {
  const [choice, setChoice] = useState<string>("");
  const [state, setState] = useState<State>({ kind: "idle" });

  async function book(e: React.FormEvent) {
    e.preventDefault();
    if (!choice || state.kind === "sending") return;
    setState({ kind: "sending" });
    try {
      const res = await fetch("/api/pick-time", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, slot: choice }),
      });
      const j = (await res.json().catch(() => null)) as { spoken?: string; changes_left?: number; error?: string } | null;
      if (res.ok && j?.spoken) return setState({ kind: "done", spoken: j.spoken, changesLeft: j.changes_left ?? 0 });
      setState({ kind: "error", message: j?.error ?? "Something went wrong. Try again in a minute." });
    } catch {
      setState({ kind: "error", message: "Could not reach Pingo. Check your connection and try again." });
    }
  }

  if (state.kind === "done") {
    return (
      <div role="status" className="rounded-md bg-accent-soft px-4 py-4 text-accent-ink">
        <p className="text-[16px] font-semibold">You’re booked for {state.spoken}</p>
        <p className="mt-1 text-[14px]">
          Aditi from {company} will call you then. Keep your phone nearby; the chat takes about 10 minutes.
          {state.changesLeft > 0 ? " You can change the time once more from the same link." : ""}
        </p>
      </div>
    );
  }

  if (!slots.length) {
    return (
      <p className="rounded-md border border-line bg-bg px-4 py-3 text-[14px] text-text-2">
        No other times are free this week. The call will go ahead as planned.
      </p>
    );
  }

  const sending = state.kind === "sending";
  return (
    <form onSubmit={book} className="flex flex-col gap-4">
      <fieldset>
        <legend className="mb-2 text-[13px] font-medium text-text-2">Free times</legend>
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
          {slots.map((s) => {
            const on = choice === s.iso;
            return (
              <label
                key={s.iso}
                className={`flex h-12 cursor-pointer items-center justify-center rounded-[10px] border px-2 text-center text-[14px] font-medium transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent ${
                  on ? "border-accent bg-accent-soft text-accent-ink" : "border-line-strong bg-surface text-text hover:bg-sunken"
                }`}
              >
                <input type="radio" name="slot" value={s.iso} checked={on} onChange={() => setChoice(s.iso)} className="sr-only" />
                {s.label}
              </label>
            );
          })}
        </div>
      </fieldset>

      {state.kind === "error" ? (
        <p role="alert" className="rounded-md bg-red-bg px-3 py-2 text-[13px] text-red">
          {state.message}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={!choice || sending}
        className="h-11 rounded-[10px] bg-accent font-semibold text-white transition-colors hover:bg-accent-ink disabled:opacity-60"
      >
        {sending ? "Booking" : "Book this time"}
      </button>
      <p className="text-[12.5px] text-text-3">
        {changesLeft === 1 ? "You can change the time one more time." : "You can change the time up to twice."} Times are in India time.
      </p>
    </form>
  );
}
