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
  /** Null when Claude assigned the code from a CIM rather than the keyword placeholder. */
  confidence: number | null;
  rationale: string;
  alternates: { code: string; title: string }[];
}

export interface AiSummary {
  summary: string;
  highlights: string[];
  risks: string[];
  generatedAt: string;
  /** "claude": written by Claude from an uploaded CIM. "placeholder": templated from the form. */
  model: "placeholder" | "claude";
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

/** The buyer's existing company, asked only when the buyer already owns one. */
export interface CurrentBusiness {
  name: string;
  website: string;
  city: string;
  state: string;
  yearFounded: number;
  employees: number;
  description: string;
  revenueLTM: number;
  revenuePrior: number;
  ebitdaLTM: number;
  existingDebt: number;
  /** The buyer's stake in it, 0 to 100. */
  ownershipPct: number;
}

/** Who is buying, for acquisition raises. */
export interface Acquirer {
  ownsBusiness: boolean;
  current: CurrentBusiness | null;
  /** The acquired business will be combined with the current one (an add-on), so it is underwritten on combined figures. */
  combine: boolean;
  background: string;
}

/** What Claude read out of an uploaded CIM. Every value is null when the document doesn't state it. */
export interface CimExtraction {
  fileName: string;
  pageCount: number | null;
  /** Pages actually read, when the document was longer than one request allows. */
  pagesRead: number | null;
  extractedAt: string;
  values: {
    companyName: string | null;
    website: string | null;
    city: string | null;
    state: string | null;
    yearFounded: number | null;
    employees: number | null;
    description: string | null;
    revenueLTM: number | null;
    revenuePrior: number | null;
    ebitdaLTM: number | null;
    topCustomerPct: number | null;
    existingDebt: number | null;
    askingPrice: number | null;
    sellerNote: number | null;
  };
  /** Which period or measure each figure is, e.g. "Adj. EBITDA, LTM Jun-26". */
  labels: { revenueLTM: string | null; revenuePrior: string | null; ebitdaLTM: string | null };
  sources: { field: string; page: number | null; quote: string }[];
  naics: { code: string; title: string; rationale: string } | null;
  reasonForSale: string | null;
  summary: string;
  keyFacts: string[];
  risks: string[];
  notFound: string[];
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
    /** Acquisitions only. */
    purchasePrice?: number | null;
    sellerNote?: number | null;
    buyerEquity?: number | null;
  };
  financials: {
    revenueLTM: number;
    revenuePrior: number;
    ebitdaLTM: number;
    topCustomerPct: number;
    existingDebt: number;
  };
  /** Acquisitions only. When set, `company` and `financials` describe the business being acquired. */
  acquirer?: Acquirer | null;
  cim?: CimExtraction | null;
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

export type OwnershipRequirement = "none" | "minority" | "minority_or_women" | "specific";

/**
 * A capital provider profile. Dollar bounds are null when the provider hasn't published them:
 * null means "unknown, confirm directly", never zero or unlimited.
 */
export interface Provider {
  id: string;
  /** Row ID in the research workbook, e.g. "AG04". */
  ref: string;
  name: string;
  fund: string;
  category: string;
  type: string;
  relevance: string;
  capitalTypes: CapitalType[];
  checkMin: number | null;
  checkMax: number | null;
  checkNote: string;
  ebitdaMin: number | null;
  ebitdaMax: number | null;
  requiresPositiveEbitda: boolean;
  ebitdaNote: string;
  revenueMin: number | null;
  revenueMax: number | null;
  revenueNote: string;
  minYears: number | null;
  /** Max pro forma total debt / EBITDA. Only applied to debt requests. */
  maxLeverage: number | null;
  /** "National" or two-letter state codes. */
  geographies: string[];
  /** States that may be served but aren't confirmed (e.g. "parts of surrounding states"); matching flags them to confirm. */
  geographiesConfirm: string[];
  /** A location rule the submission can't answer (e.g. Opportunity Zone); always "confirm". */
  geographyConfirm: string | null;
  geographyNote: string;
  /** NAICS sector keys, e.g. "23", "31-33", "62". */
  sectorsPreferred: string[];
  /** When true, only deals in sectorsPreferred qualify. */
  sectorsOnly: boolean;
  sectorsExcluded: string[];
  industriesNote: string;
  exclusionsNote: string;
  useOfFunds: UseOfFunds[];
  /** Uses that may be allowed but aren't published; matching flags them to confirm. */
  useOfFundsConfirm: UseOfFunds[];
  strategyNote: string;
  ownershipRequirement: OwnershipRequirement;
  /** For "specific": the group the provider serves, e.g. "Native American or tribal ownership". */
  ownershipLabel: string | null;
  ownershipNote: string;
  controlNote: string;
  acquisitionNote: string;
  diverseFocus: boolean;
  status: string;
  nextQuestion: string;
  sourceQuality: string;
  sources: string[];
  researchChecked: string | null;
  /** How the prose criteria were turned into matching rules. */
  interpretations: string[];
  contact: { name: string; email: string } | null;
}

export interface Db {
  submissions: Submission[];
  providers: Provider[];
}
