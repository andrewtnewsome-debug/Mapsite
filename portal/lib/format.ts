import type { CapitalType, Status, Timeline, UseOfFunds } from "./types";

export const CAPITAL_TYPE_LABELS: Record<CapitalType, string> = {
  senior_debt: "Senior debt",
  sba_7a: "SBA 7(a) loan",
  mezzanine: "Mezzanine / subordinated debt",
  revenue_based: "Revenue-based financing",
  minority_equity: "Minority equity",
  majority_equity: "Majority equity",
};

export const DEBT_TYPES: CapitalType[] = ["senior_debt", "sba_7a", "mezzanine", "revenue_based"];

export const USE_OF_FUNDS_LABELS: Record<UseOfFunds, string> = {
  acquisition: "Acquisition",
  growth: "Growth / expansion",
  refinance: "Refinance existing debt",
  recap: "Recapitalization / owner liquidity",
  working_capital: "Working capital",
  equipment: "Equipment purchase",
  real_estate: "Real estate",
};

export const TIMELINE_LABELS: Record<Timeline, string> = {
  "0-3": "Within 3 months",
  "3-6": "3 to 6 months",
  "6-12": "6 to 12 months",
};

export const STATUS_LABELS: Record<Status, string> = {
  new: "New",
  in_review: "In review",
  introduced: "Introduced",
  closed: "Closed",
  declined: "Declined",
};

export const SECTOR_LABELS: Record<string, string> = {
  "11": "Agriculture & food production",
  "22": "Utilities & energy services",
  "23": "Construction",
  "31-33": "Manufacturing",
  "42": "Wholesale trade",
  "44-45": "Retail trade",
  "48-49": "Transportation & warehousing",
  "51": "Information & software",
  "52": "Finance",
  "53": "Real estate",
  "54": "Professional services",
  "56": "Admin & facility services",
  "61": "Education",
  "62": "Health care & social assistance",
  "72": "Food service & hospitality",
  "81": "Other services",
};

export const US_STATES = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DC", "DE", "FL", "GA", "HI", "ID", "IL", "IN", "IA",
  "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM",
  "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA",
  "WV", "WI", "WY",
];

/** "National", "OH, IN, KY", or "All states except FL, TX" for long lists. */
export function stateList(states: string[]): string {
  if (states.includes("National")) return "National";
  if (states.length > US_STATES.length - 10) {
    return `All states except ${US_STATES.filter((s) => !states.includes(s)).join(", ")}`;
  }
  return states.join(", ");
}

/** Lowercases only the first letter, so "SBA 7(a) loan" stays intact mid-sentence. */
export function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

/** $14.2M, $850K */
export function money(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1_000_000) {
    const m = abs / 1_000_000;
    return `${sign}$${m >= 10 ? m.toFixed(1).replace(/\.0$/, "") : m.toFixed(2).replace(/0$/, "").replace(/\.0$/, "")}M`;
  }
  if (abs >= 1_000) return `${sign}$${Math.round(abs / 1_000)}K`;
  return `${sign}$${abs}`;
}

export function pct(n: number, digits = 0): string {
  return `${n.toFixed(digits)}%`;
}

/** "$1M to $10M", "Up to $350K", "$2M and up", or null when nothing is published. */
export function range(min: number | null, max: number | null): string | null {
  if (min !== null && max !== null) return `${money(min)} to ${money(max)}`;
  if (max !== null) return `Up to ${money(max)}`;
  if (min !== null) return `${money(min)} and up`;
  return null;
}

export function multiple(n: number): string {
  return `${n.toFixed(1)}x`;
}

export function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function dateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function margin(revenue: number, ebitda: number): number {
  return revenue > 0 ? (ebitda / revenue) * 100 : 0;
}

export function growth(current: number, prior: number): number | null {
  return prior > 0 ? ((current - prior) / prior) * 100 : null;
}
