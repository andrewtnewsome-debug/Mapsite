import { brand } from "@/config/brand";
import type { DealStatus, DealType } from "./types";

export const DEAL_TYPE_LABEL: Record<DealType, string> = {
  minority: "Minority Investment",
  majority: "Majority Sale",
  full_exit: "Full Exit",
  growth: "Growth Capital",
};

export const DEAL_TYPE_SHORT: Record<DealType, string> = {
  minority: "Minority",
  majority: "Majority",
  full_exit: "Full Exit",
  growth: "Growth",
};

export const DEAL_STATUS_LABEL: Record<DealStatus, string> = {
  draft: "Draft",
  pending_review: "Pending Review",
  changes_requested: "Changes Requested",
  live: "Live",
  paused: "Paused",
};

export interface Band {
  id: string;
  label: string;
  min: number;
  max: number;
}

export const REVENUE_BANDS: Band[] = [
  { id: "lt5", label: "Under $5M", min: 0, max: 5_000_000 },
  { id: "5-10", label: "$5M – $10M", min: 5_000_000, max: 10_000_000 },
  { id: "10-25", label: "$10M – $25M", min: 10_000_000, max: 25_000_000 },
  { id: "gt25", label: "$25M+", min: 25_000_000, max: Infinity },
];

export const EBITDA_BANDS: Band[] = [
  { id: "lt1", label: "Under $1M", min: 0, max: 1_000_000 },
  { id: "1-2.5", label: "$1M – $2.5M", min: 1_000_000, max: 2_500_000 },
  { id: "2.5-5", label: "$2.5M – $5M", min: 2_500_000, max: 5_000_000 },
  { id: "gt5", label: "$5M+", min: 5_000_000, max: Infinity },
];

export const YEARS_OPTIONS = [
  { value: 0, label: "Any" },
  { value: 5, label: "5+ years" },
  { value: 10, label: "10+ years" },
  { value: 20, label: "20+ years" },
];

/** Certification filter options. "MBE" matches every listing. */
export const CERT_FILTERS = [
  { id: "MBE", label: `${brand.sponsor.short} MBE` },
  { id: "WBE", label: "Dual MBE / WBE" },
  { id: "DBE", label: "DBE" },
  { id: "8(a)", label: "SBA 8(a)" },
  { id: "HUBZone", label: "HUBZone" },
  { id: "VOSB", label: "Veteran-Owned (VOSB)" },
];

export const CRITERIA_FIT_OPTIONS = [
  "Strong fit: within all stated investment criteria",
  "Good fit: outside one criterion, with a clear rationale",
  "Opportunistic: outside stated criteria, high interest",
];

export const CAPITAL_OPTIONS = [
  "Committed fund capital, available now",
  "Balance sheet capital, available now",
  "Committed investors; deal-by-deal approval",
  "Capital partners identified; commitment pending",
  "Debt financing to be arranged (SBA or senior lender)",
];

export const TIMELINE_OPTIONS = [
  "Ready to submit an IOI within 2 weeks",
  "IOI within 30 days",
  "IOI within 60 days",
  "Exploratory: 90+ days",
];
