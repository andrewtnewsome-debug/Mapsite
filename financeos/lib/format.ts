/** Display formatting shared by server and client code. */

export const NOT_AVAILABLE = "Not available";

const currencyFormatters = new Map<string, Intl.NumberFormat>();

function currencyFormatter(currency: string, decimals: number): Intl.NumberFormat {
  const key = `${currency}:${decimals}`;
  let f = currencyFormatters.get(key);
  if (!f) {
    f = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
    currencyFormatters.set(key, f);
  }
  return f;
}

export function formatCurrency(value: number | null | undefined, opts: { currency?: string; cents?: boolean } = {}): string {
  if (value == null || !Number.isFinite(value)) return NOT_AVAILABLE;
  const normalized = Object.is(value, -0) || Math.abs(value) < 0.005 ? 0 : value;
  return currencyFormatter(opts.currency ?? "USD", opts.cents ? 2 : 0).format(normalized);
}

/** $1.2M, $845K, $9,200 */
export function formatCurrencyCompact(value: number | null | undefined, currency = "USD"): string {
  if (value == null || !Number.isFinite(value)) return NOT_AVAILABLE;
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  const symbol = currency === "USD" ? "$" : `${currency} `;
  if (abs >= 1_000_000) {
    const m = (abs / 1_000_000).toFixed(abs >= 10_000_000 ? 1 : 2).replace(/\.?0+$/, "");
    return `${sign}${symbol}${m}M`;
  }
  if (abs >= 10_000) return `${sign}${symbol}${Math.round(abs / 1_000)}K`;
  return formatCurrency(value, { currency });
}

export function formatPercent(value: number | null | undefined, decimals = 1): string {
  if (value == null || !Number.isFinite(value)) return NOT_AVAILABLE;
  return `${(value * 100).toFixed(decimals)}%`;
}

export function formatSignedPercent(value: number | null | undefined, decimals = 1): string {
  if (value == null || !Number.isFinite(value)) return NOT_AVAILABLE;
  const pct = (value * 100).toFixed(decimals);
  return `${value > 0 ? "+" : ""}${pct}%`;
}

export function formatNumber(value: number | null | undefined, decimals = 0): string {
  if (value == null || !Number.isFinite(value)) return NOT_AVAILABLE;
  return value.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export function formatRatio(value: number | null | undefined, format: "ratio" | "percent" | "days" | "currency" | "months"): string {
  if (value == null || !Number.isFinite(value)) return NOT_AVAILABLE;
  switch (format) {
    case "ratio":
      return `${value.toFixed(2)}x`;
    case "percent":
      return formatPercent(value);
    case "days":
      return `${Math.round(value)} days`;
    case "months":
      return `${value.toFixed(1)} months`;
    case "currency":
      return formatCurrency(value);
  }
}

export function formatTimestamp(iso: string | null | undefined): string {
  if (!iso) return NOT_AVAILABLE;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return NOT_AVAILABLE;
  return d.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}
