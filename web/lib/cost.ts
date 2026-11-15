/**
 * Call cost. Bolna reports `total_cost` in US cents (bolna/app-agent.md §4); calls.cost stores it
 * as given. The UI shows dollars, plus a clearly derived rupee figure at a configurable rate.
 */
export const DEFAULT_FX_INR_PER_USD = 88;

/** INR per USD from env COST_FX_INR_PER_USD (server side), else 88. */
export function fxInrPerUsd(raw: string | undefined = process.env.COST_FX_INR_PER_USD): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 && n < 10_000 ? n : DEFAULT_FX_INR_PER_USD;
}

export function formatUsdFromCents(cents: number): string {
  const usd = (Number.isFinite(cents) ? cents : 0) / 100;
  return `$${usd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatInrFromCents(cents: number, fx: number = DEFAULT_FX_INR_PER_USD): string {
  const inr = ((Number.isFinite(cents) ? cents : 0) / 100) * fx;
  return `₹${Math.round(inr).toLocaleString("en-IN")}`;
}

export function formatCallCost(cents: number, fx: number = DEFAULT_FX_INR_PER_USD): { usd: string; inr: string } {
  return { usd: formatUsdFromCents(cents), inr: formatInrFromCents(cents, fx) };
}
