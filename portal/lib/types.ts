export type CapitalType =
  | "senior_debt"
  | "sba_7a"
  | "mezzanine"
  | "revenue_based"
  | "minority_equity"
  | "majority_equity";

export type UseOfFunds =
  | "acquisition"
  | "growth"
  | "refinance"
  | "recap"
  | "working_capital"
  | "equipment"
  | "real_estate";

export type Status = "new" | "in_review" | "introduced" | "closed" | "declined";

export type Timeline = "0-3" | "3-6" | "6-12";

export interface NaicsResult {
  code: string;
  title: string;
  sector: string;
  confidence: number;
  rationale: string;
  alternates: { code: string; title: string }[];
}

export interface AiSummary {
  summary: string;
  highlights: string[];
  risks: string[];
  generatedAt: string;
  model: "placeholder";
}

export interface Note {
  at: string;
  author: string;
  text: string;
}

export interface Introduction {
  providerId: string;
  at: string;
}

export interface Submission {
  id: string;
  createdAt: string;
  status: Status;
  contact: { name: string; title: string; email: string; phone: string };
  company: {
    name: string;
    website: string;
    city: string;
    state: string;
    yearFounded: number;
    employees: number;
    description: string;
  };
  ownership: { diverseOwned: boolean; ownerOperator: boolean };
  deal: {
    amount: number;
    capitalType: CapitalType;
    useOfFunds: UseOfFunds;
    timeline: Timeline;
    details: string;
  };
  financials: {
    revenueLTM: number;
    revenuePrior: number;
    ebitdaLTM: number;
    topCustomerPct: number;
    existingDebt: number;
  };
  naics: NaicsResult;
  ai: AiSummary;
  notes: Note[];
  introductions: Introduction[];
}

/** The fields an applicant fills in; NAICS and the summary are added on intake. */
export type SubmissionInput = Omit<
  Submission,
  "id" | "createdAt" | "status" | "naics" | "ai" | "notes" | "introductions"
>;

export type ProviderType =
  | "Bank"
  | "SBA Lender"
  | "CDFI"
  | "Private Credit"
  | "Specialty Lender"
  | "Mezzanine Fund"
  | "Private Equity"
  | "Search Fund Investor"
  | "Family Office";

export interface Provider {
  id: string;
  name: string;
  type: ProviderType;
  capitalTypes: CapitalType[];
  checkMin: number;
  checkMax: number;
  minEbitda: number;
  minRevenue: number;
  /** Max pro forma total debt / EBITDA. Only applied to debt requests. */
  maxLeverage: number | null;
  /** "National" or two-letter state codes. */
  geographies: string[];
  /** NAICS sector keys, e.g. "23", "31-33", "62". */
  sectorsPreferred: string[];
  /** When true, only deals in sectorsPreferred qualify. */
  sectorsOnly: boolean;
  sectorsExcluded: string[];
  useOfFunds: UseOfFunds[];
  diverseFocus: boolean;
  contact: { name: string; email: string };
  notes: string;
}

export interface Db {
  submissions: Submission[];
  providers: Provider[];
}
