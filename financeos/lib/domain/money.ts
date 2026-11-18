/** Money helpers. Values are plain numbers in the company currency. */

/** Round to cents using half-away-from-zero, avoiding binary floating point drift (1.005 -> 1.01). */
export function roundCents(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const sign = value < 0 ? -1 : 1;
  return (sign * Math.round(Math.abs(value) * 100 + 1e-7)) / 100;
}

export function sum(values: Iterable<number>): number {
  let total = 0;
  for (const v of values) total += v;
  return roundCents(total);
}

export function sumBy<T>(items: readonly T[], pick: (item: T) => number): number {
  let total = 0;
  for (const item of items) total += pick(item);
  return roundCents(total);
}

/** Safe division: returns null when the denominator is zero or either side is unavailable. */
export function safeDivide(numerator: number | null | undefined, denominator: number | null | undefined): number | null {
  if (numerator == null || denominator == null) return null;
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return null;
  return numerator / denominator;
}

/** Percentage change from `previous` to `current`; null when previous is 0 or unavailable. */
export function pctChange(current: number | null | undefined, previous: number | null | undefined): number | null {
  if (current == null || previous == null || previous === 0) return null;
  return (current - previous) / Math.abs(previous);
}

/** Parse a money-like value from an external source ("1,234.50", "", null, 12). */
export function parseAmount(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? roundCents(value) : null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const negativeParens = /^\(.*\)$/.test(trimmed);
  const cleaned = trimmed.replace(/[,$\s()]/g, "");
  if (!/^-?\d*\.?\d+$/.test(cleaned)) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  return roundCents(negativeParens ? -Math.abs(n) : n);
}
