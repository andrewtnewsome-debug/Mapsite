// Core data model for the Certified Exchange prototype.
// All records are mock data; see /data for seed files.

export type Role = "investor" | "owner" | "admin";

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  firmName: string;
  title: string;
}

export const INDUSTRIES = [
  "Industrial Manufacturing",
  "Logistics & Trucking",
  "Food Manufacturing",
  "Healthcare Services",
  "IT Services",
  "Commercial Construction",
  "Facilities Services",
  "Staffing",
  "Packaging",
  "Consumer Products",
] as const;
export type Industry = (typeof INDUSTRIES)[number];

export const REGIONS = ["Northeast", "Mid-Atlantic", "Southeast", "Midwest", "Southwest", "West"] as const;
export type Region = (typeof REGIONS)[number];

export const DEAL_TYPES = ["minority", "majority", "full_exit", "growth"] as const;
export type DealType = (typeof DEAL_TYPES)[number];

export type DealStatus = "draft" | "pending_review" | "changes_requested" | "live" | "paused";

export const EMPLOYEE_RANGES = ["1–10", "11–50", "51–100", "101–250", "251–500", "500+"] as const;
export type EmployeeRange = (typeof EMPLOYEE_RANGES)[number];

/** Certifications a business may hold in addition to its NMSDC MBE certification. */
export const ADDITIONAL_CERTS = ["WBE", "DBE", "8(a)", "HUBZone", "VOSB"] as const;
export type AdditionalCert = (typeof ADDITIONAL_CERTS)[number];

export type InvestorType =
  | "Search Fund"
  | "Independent Sponsor"
  | "Family Office"
  | "Private Equity"
  | "Strategic Acquirer";

export interface InvestorProfile {
  id: string;
  userId: string;
  firmName: string;
  firmType: InvestorType;
  headquarters: string;
  website: string;
  overview: string;
  /** Equity check size in USD. */
  checkSizeMin: number;
  checkSizeMax: number;
  /** Target company EBITDA in USD. */
  ebitdaMin: number;
  ebitdaMax: number;
  industries: Industry[];
  geographies: Region[];
  dealTypes: DealType[];
  verified: boolean;
  capitalSource: string;
  recentActivity: string[];
}

export type CertVerification = "verified" | "pending";

export interface CertifiedBusiness {
  id: string;
  ownerUserId: string;
  /** Revealed only after NDA. */
  legalName: string;
  certificationType: "MBE";
  certificationNumber: string;
  certifyingCouncil: string;
  /** ISO date (YYYY-MM-DD). */
  certificationExpiry: string;
  /** Admin verification against the certifying council's records. */
  verification: CertVerification;
  verifiedAt?: string;
  additionalCertifications: AdditionalCert[];
  ownershipNote: string;
  industry: Industry;
  state: string;
  region: Region;
  /** Revealed only after NDA. */
  city: string;
  yearsInBusiness: number;
  employeeRange: EmployeeRange;
}

export interface CimFinancialYear {
  year: string;
  revenue: number;
  grossProfit: number;
  operatingExpenses: number;
  reportedEbitda: number;
  addBacks: number;
  adjustedEbitda: number;
  capex: number;
}

export interface CimContent {
  overview: string[];
  servicesHeading: string;
  services: { name: string; share: number; detail: string }[];
  financials: CimFinancialYear[];
  financialNotes: string[];
  customers: {
    summary: string;
    activeCustomers: number;
    topCustomerPct: number;
    topTenPct: number;
    avgTenureYears: number;
    segments: { name: string; pct: number }[];
  };
  operations: {
    summary: string;
    facilities: { location: string; use: string; sqft: number; tenure: string }[];
    workforce: { group: string; count: number }[];
    systems: string[];
    quality: string[];
  };
  management: { name: string; title: string; tenureYears: number; note: string }[];
  growth: string[];
  transaction: {
    useOfProceeds: string;
    ownerRole: string;
    timing: string;
  };
}

export interface Deal {
  id: string;
  businessId: string;
  status: DealStatus;
  dealType: DealType;
  /** FY2025 revenue in USD. */
  revenue: number;
  /** FY2025 adjusted EBITDA in USD. */
  ebitda: number;
  askingValuation?: number;
  teaserTitle: string;
  teaserDescription: string;
  highlights: string[];
  /** What the owner is looking for in a partner. Visible in the teaser. */
  seeking: string;
  /** Revealed only after NDA. */
  companyName: string;
  /** Revealed only after NDA. */
  city: string;
  createdAt: string;
  listedAt?: string;
  submittedAt?: string;
  reviewNote?: string;
  /** Anonymous teaser views, shown to owners as a count only. */
  teaserViews: number;
  cim: CimContent;
}

export interface NDA {
  id: string;
  dealId: string;
  investorUserId: string;
  signedName: string;
  signedTitle: string;
  firmName: string;
  signedAt: string;
  version: string;
}

export interface Inquiry {
  id: string;
  dealId: string;
  investorUserId: string;
  message: string;
  criteriaFit: string;
  capitalAvailable: string;
  timeline: string;
  createdAt: string;
}

export interface Message {
  id: string;
  /** `${dealId}__${investorUserId}` */
  threadId: string;
  senderUserId: string;
  body: string;
  createdAt: string;
}

export interface SavedDeal {
  investorUserId: string;
  dealId: string;
  savedAt: string;
}

export interface DealFilters {
  query: string;
  industries: Industry[];
  regions: Region[];
  states: string[];
  revenueBands: string[];
  ebitdaBands: string[];
  dealTypes: DealType[];
  certifications: string[];
  minYears: number;
  matchCriteria: boolean;
}

export interface SavedSearch {
  id: string;
  investorUserId: string;
  name: string;
  filters: DealFilters;
  createdAt: string;
}

export type ActivityKind =
  | "nda_signed"
  | "inquiry_sent"
  | "message_sent"
  | "listing_submitted"
  | "listing_approved"
  | "changes_requested"
  | "listing_paused"
  | "listing_resumed"
  | "cert_verified"
  | "investor_verified"
  | "investor_unverified";

export interface ActivityEvent {
  id: string;
  kind: ActivityKind;
  actorUserId: string;
  dealId?: string;
  subjectId?: string;
  detail: string;
  createdAt: string;
}
