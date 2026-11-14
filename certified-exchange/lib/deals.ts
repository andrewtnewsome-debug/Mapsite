import type { CertifiedBusiness, Deal, DealFilters, InvestorProfile } from "@/data/types";
import { EBITDA_BANDS, REVENUE_BANDS } from "@/data/taxonomy";
import { STATE_NAMES } from "@/data/businesses";
import { daysUntil } from "./format";

export type SortKey = "newest" | "revenue" | "ebitda";

export interface DealRow {
  deal: Deal;
  business: CertifiedBusiness;
}

function inBands(value: number, bandIds: string[], bands = REVENUE_BANDS) {
  if (!bandIds.length) return true;
  return bands.some((b) => bandIds.includes(b.id) && value >= b.min && value < b.max);
}

export interface CriteriaMatch {
  score: number;
  total: number;
  checks: { label: string; pass: boolean }[];
}

export function criteriaMatch(row: DealRow, profile: InvestorProfile | undefined): CriteriaMatch | undefined {
  if (!profile) return undefined;
  const { deal, business } = row;
  const checks = [
    { label: "EBITDA range", pass: deal.ebitda >= profile.ebitdaMin && deal.ebitda <= profile.ebitdaMax },
    { label: "Industry", pass: profile.industries.includes(business.industry) },
    { label: "Geography", pass: profile.geographies.includes(business.region) },
    { label: "Deal type", pass: profile.dealTypes.includes(deal.dealType) },
  ];
  return { score: checks.filter((c) => c.pass).length, total: checks.length, checks };
}

export function filterDeals(rows: DealRow[], f: DealFilters, profile?: InvestorProfile): DealRow[] {
  const q = f.query.trim().toLowerCase();
  return rows.filter(({ deal, business }) => {
    if (f.industries.length && !f.industries.includes(business.industry)) return false;
    if (f.regions.length && !f.regions.includes(business.region)) return false;
    if (f.states.length && !f.states.includes(business.state)) return false;
    if (!inBands(deal.revenue, f.revenueBands, REVENUE_BANDS)) return false;
    if (!inBands(deal.ebitda, f.ebitdaBands, EBITDA_BANDS)) return false;
    if (f.dealTypes.length && !f.dealTypes.includes(deal.dealType)) return false;
    if (f.certifications.length) {
      const held = ["MBE", ...business.additionalCertifications] as string[];
      if (!f.certifications.every((c) => held.includes(c))) return false;
    }
    if (f.minYears && business.yearsInBusiness < f.minYears) return false;
    if (f.matchCriteria && profile) {
      const m = criteriaMatch({ deal, business }, profile);
      if (!m || m.score < m.total) return false;
    }
    if (q) {
      const hay = [
        deal.teaserTitle,
        deal.teaserDescription,
        deal.seeking,
        ...deal.highlights,
        business.industry,
        business.state,
        STATE_NAMES[business.state] ?? "",
        business.region,
        business.certifyingCouncil,
      ]
        .join(" ")
        .toLowerCase();
      if (!q.split(/\s+/).every((term) => hay.includes(term))) return false;
    }
    return true;
  });
}

export function sortDeals(rows: DealRow[], sort: SortKey): DealRow[] {
  const copy = [...rows];
  if (sort === "revenue") copy.sort((a, b) => b.deal.revenue - a.deal.revenue);
  else if (sort === "ebitda") copy.sort((a, b) => b.deal.ebitda - a.deal.ebitda);
  else copy.sort((a, b) => (b.deal.listedAt ?? b.deal.createdAt).localeCompare(a.deal.listedAt ?? a.deal.createdAt));
  return copy;
}

export function activeFilterCount(f: DealFilters) {
  return (
    f.industries.length +
    f.regions.length +
    f.states.length +
    f.revenueBands.length +
    f.ebitdaBands.length +
    f.dealTypes.length +
    f.certifications.length +
    (f.minYears ? 1 : 0) +
    (f.matchCriteria ? 1 : 0) +
    (f.query.trim() ? 1 : 0)
  );
}

/** Human summary of a filter set for saved searches. */
export function describeFilters(f: DealFilters): string[] {
  const parts: string[] = [];
  if (f.query.trim()) parts.push(`"${f.query.trim()}"`);
  if (f.industries.length) parts.push(f.industries.join(", "));
  if (f.regions.length) parts.push(f.regions.join(", "));
  if (f.states.length) parts.push(f.states.join(", "));
  if (f.revenueBands.length) parts.push(`Revenue ${REVENUE_BANDS.filter((b) => f.revenueBands.includes(b.id)).map((b) => b.label).join(", ")}`);
  if (f.ebitdaBands.length) parts.push(`EBITDA ${EBITDA_BANDS.filter((b) => f.ebitdaBands.includes(b.id)).map((b) => b.label).join(", ")}`);
  if (f.dealTypes.length) parts.push(f.dealTypes.map((d) => ({ minority: "Minority", majority: "Majority", full_exit: "Full exit", growth: "Growth" })[d]).join(", "));
  if (f.certifications.length) parts.push(f.certifications.join(", "));
  if (f.minYears) parts.push(`${f.minYears}+ years`);
  if (f.matchCriteria) parts.push("Matches my criteria");
  return parts.length ? parts : ["All live deals"];
}

export type CertHealth = "verified" | "expiring" | "expired" | "pending";

export function certHealth(b: CertifiedBusiness): { status: CertHealth; days: number } {
  const days = daysUntil(b.certificationExpiry);
  if (days < 0) return { status: "expired", days };
  if (b.verification === "pending") return { status: "pending", days };
  if (days <= 90) return { status: "expiring", days };
  return { status: "verified", days };
}
