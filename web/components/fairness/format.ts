/** Display helpers for bias watch (pure). */

export const pct = (x: number) => `${Math.round(x * 100)}%`;

export const score1 = (x: number | null | undefined) => (typeof x === "number" ? x.toFixed(1) : "–");

/** Signed gap with a real minus sign: "+3.2", "−12.4", "0.0". */
export function signed(x: number): string {
  if (Math.abs(x) < 0.05) return "0.0";
  return `${x > 0 ? "+" : "−"}${Math.abs(x).toFixed(1)}`;
}

export const people = (n: number) => `${n} ${n === 1 ? "person" : "people"}`;
