import { brand } from "@/config/brand";

/** Compact currency: $18.4M, $680K, $1.35M */
export function money(n: number | undefined) {
  if (n === undefined || n === null || Number.isNaN(n)) return "—";
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1_000_000) {
    const v = abs / 1_000_000;
    // Keep two decimals only when they carry information ($1.35M), otherwise one ($18.4M).
    const twoDp = v < 10 && Math.round(v * 100) % 10 !== 0;
    const digits = v >= 100 ? 0 : twoDp ? 2 : Number.isInteger(Math.round(v * 10) / 10) ? 0 : 1;
    return `${sign}$${v.toFixed(digits)}M`;
  }
  if (abs >= 1_000) return `${sign}$${Math.round(abs / 1_000)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

/** Table format in thousands: 18,400 or (212) for negatives. */
export function thousands(n: number) {
  const v = Math.round(n / 1000);
  return v < 0 ? `(${Math.abs(v).toLocaleString("en-US")})` : v.toLocaleString("en-US");
}

export function pct(n: number, digits = 1) {
  if (!Number.isFinite(n)) return "—";
  return `${(n * 100).toFixed(digits)}%`;
}

export function margin(ebitda: number, revenue: number) {
  return revenue ? ebitda / revenue : 0;
}

export function shortDate(iso: string | undefined) {
  if (!iso) return "—";
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00` : iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function dateTime(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function relativeTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.round(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 30) return `${day}d ago`;
  return shortDate(iso);
}

export function daysUntil(isoDate: string) {
  const end = new Date(`${isoDate}T23:59:59`).getTime();
  return Math.ceil((end - Date.now()) / 86_400_000);
}

/** Public listing reference, e.g. CX-1007 */
export function dealRef(dealId: string) {
  return `${brand.refPrefix}-${dealId.replace(/^d-/, "")}`;
}

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}
