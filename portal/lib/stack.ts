import { CAPITAL_TYPE_LABELS, DEBT_TYPES } from "./format";
import { enrichSubmission } from "./enrich";
import { matchProviders, type MatchResult } from "./matching";
import type { AiSummary, CapitalType, CimExtraction, NaicsResult, Provider, Submission, SubmissionInput, UseOfFunds } from "./types";

/**
 * The internal matching tool: a deal is a company (usually read from a CIM) plus a capital stack.
 * Each piece of the stack that outside capital could fill is matched against the lender list on its own.
 */

/** Capital types are matched; a seller note and the buyer's own cash are part of the stack but not matched. */
export type PieceType = CapitalType | "seller_note" | "buyer_equity";

export const PIECE_LABELS: Record<PieceType, string> = {
  ...CAPITAL_TYPE_LABELS,
  seller_note: "Seller note",
  buyer_equity: "Buyer's own equity",
};

export const isMatched = (t: PieceType): t is CapitalType => t in CAPITAL_TYPE_LABELS;

export interface StackPiece {
  id: string;
  type: PieceType;
  amount: number;
}

export type OutreachStatus = "contacted" | "interested" | "passed";
export const OUTREACH_LABELS: Record<OutreachStatus, string> = { contacted: "Contacted", interested: "Interested", passed: "Passed" };

export interface DealNote {
  at: string;
  /** Viewer id of the author, when known. Names are looked up when shown. */
  by: string | null;
  text: string;
}

export interface Deal {
  id: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  /** "acquisition": a buyer is acquiring the company in the CIM. "raise": the company itself is raising. */
  kind: "acquisition" | "raise";
  company: Submission["company"];
  financials: Submission["financials"];
  /** The buyer (acquisitions) or the company's owners are minority-owned. */
  diverseOwned: boolean;
  useOfFunds: UseOfFunds;
  purchasePrice: number | null;
  pieces: StackPiece[];
  details: string;
  cim: CimExtraction | null;
  naics: NaicsResult;
  summary: AiSummary;
  notes: DealNote[];
  /** Outreach per lender id. */
  outreach: Record<string, { status: OutreachStatus; at: string; by: string | null }>;
}

const SENIOR: PieceType[] = ["senior_debt", "sba_7a"];
const ALL_DEBT: PieceType[] = [...DEBT_TYPES, "seller_note"];

export const pieceId = () => `pc_${Math.random().toString(36).slice(2, 8)}`;
const round = (n: number, step = 25_000) => Math.max(0, Math.round(n / step) * step);

/** When the CIM gives no price: a placeholder multiple, shown as an estimate. */
export const DEFAULT_MULTIPLE = 5;

/**
 * A starting stack for an acquisition: senior debt at the lower of 3.0x EBITDA and 60% of the price,
 * the CIM's seller note (or 10%), and the buyer's equity for the rest.
 */
export function defaultAcquisitionStack(price: number, ebitda: number, sellerNote: number | null): StackPiece[] {
  const senior = ebitda > 0 ? round(Math.min(3 * ebitda, 0.6 * price)) : 0;
  const seller = Math.min(sellerNote ?? round(0.1 * price), price - senior);
  const equity = Math.max(0, price - senior - seller);
  return [
    ...(senior > 0 ? [{ id: pieceId(), type: "senior_debt" as const, amount: senior }] : []),
    ...(seller > 0 ? [{ id: pieceId(), type: "seller_note" as const, amount: seller }] : []),
    { id: pieceId(), type: "buyer_equity" as const, amount: equity },
  ];
}

export const stackTotal = (pieces: StackPiece[]) => pieces.reduce((n, p) => n + p.amount, 0);

/** Total debt / EBITDA for the whole stack, counting existing debt only when it stays in place. */
export function stackLeverage(d: Pick<Deal, "kind" | "financials" | "pieces">): { senior: number; total: number } | null {
  const e = d.financials.ebitdaLTM;
  if (e <= 0) return null;
  const existing = d.kind === "acquisition" ? 0 : d.financials.existingDebt;
  const sum = (types: PieceType[]) => d.pieces.filter((p) => types.includes(p.type)).reduce((n, p) => n + p.amount, 0);
  return { senior: (existing + sum(SENIOR)) / e, total: (existing + sum(ALL_DEBT)) / e };
}

/**
 * The deal as the matching rules see it when one piece is being raised. For leverage, a senior lender
 * counts the senior debt around it; a junior lender counts all debt, the seller note included.
 * In an acquisition the seller's own debt is paid off at closing, so it is left out.
 */
export function pieceSubmission(d: Deal, piece: StackPiece & { type: CapitalType }): Submission {
  const around = (types: PieceType[]) => d.pieces.filter((p) => p.id !== piece.id && types.includes(p.type)).reduce((n, p) => n + p.amount, 0);
  const otherDebt = around(SENIOR.includes(piece.type) ? SENIOR : ALL_DEBT);
  const existing = d.kind === "acquisition" ? 0 : d.financials.existingDebt;
  const seller = d.pieces.filter((p) => p.type === "seller_note").reduce((n, p) => n + p.amount, 0);
  const equity = d.pieces.filter((p) => p.type === "buyer_equity").reduce((n, p) => n + p.amount, 0);
  return {
    id: d.id,
    createdAt: d.createdAt,
    status: "in_review",
    contact: { name: "", title: "", email: "", phone: "" },
    company: d.company,
    ownership: { diverseOwned: d.diverseOwned, ownerOperator: true },
    deal: {
      amount: piece.amount,
      capitalType: piece.type,
      useOfFunds: d.useOfFunds,
      timeline: "3-6",
      details: d.details,
      ...(d.kind === "acquisition" ? { purchasePrice: d.purchasePrice, sellerNote: seller || null, buyerEquity: equity || null } : {}),
    },
    financials: { ...d.financials, existingDebt: existing + otherDebt },
    // A buyer with no business of its own: the target is underwritten alone.
    acquirer: d.kind === "acquisition" ? { ownsBusiness: false, current: null, combine: false, background: "" } : null,
    cim: d.cim,
    naics: d.naics,
    ai: d.summary,
    notes: [],
    introductions: [],
  };
}

export interface PieceMatch {
  piece: StackPiece & { type: CapitalType };
  submission: Submission;
  result: MatchResult;
}

export function matchStack(d: Deal, providers: Provider[]): PieceMatch[] {
  return d.pieces.flatMap((piece) => {
    if (!isMatched(piece.type) || piece.amount <= 0) return [];
    const p = piece as StackPiece & { type: CapitalType };
    const submission = pieceSubmission(d, p);
    return [{ piece: p, submission, result: matchProviders(submission, providers) }];
  });
}

export type DealInput = Omit<Deal, "id" | "createdAt" | "updatedAt" | "createdBy" | "naics" | "summary" | "notes" | "outreach">;

/** Industry code and summary: Claude's from the CIM when there is one, otherwise the keyword placeholders. */
export function dealInsights(input: DealInput, at: Date): Pick<Deal, "naics" | "summary"> {
  const asInput: SubmissionInput = {
    contact: { name: "", title: "", email: "", phone: "" },
    company: input.company,
    ownership: { diverseOwned: input.diverseOwned, ownerOperator: true },
    deal: {
      amount: stackTotal(input.pieces.filter((p) => isMatched(p.type))),
      capitalType: (input.pieces.find((p) => isMatched(p.type))?.type as CapitalType) ?? "senior_debt",
      useOfFunds: input.useOfFunds,
      timeline: "3-6",
      details: input.details,
    },
    financials: input.financials,
    acquirer: null,
    cim: input.cim,
  };
  const { naics, ai } = enrichSubmission(asInput, at);
  return { naics, summary: ai };
}

export function newDeal(input: DealInput, by: string | null, now = new Date()): Deal {
  return {
    ...input,
    ...dealInsights(input, now),
    id: `deal_${Math.random().toString(36).slice(2, 10)}`,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    createdBy: by,
    notes: [],
    outreach: {},
  };
}

/** A deal saved by the earlier portal (the Hallmark and Thor records), turned into a tool deal. */
export function dealFromSubmission(s: Submission): Deal {
  const acquisition = s.deal.useOfFunds === "acquisition";
  const pieces: StackPiece[] = [{ id: pieceId(), type: s.deal.capitalType, amount: s.deal.amount }];
  if (s.deal.sellerNote) pieces.push({ id: pieceId(), type: "seller_note", amount: s.deal.sellerNote });
  if (s.deal.buyerEquity) pieces.push({ id: pieceId(), type: "buyer_equity", amount: s.deal.buyerEquity });
  return {
    id: s.id.replace(/^sub_/, "deal_"),
    createdAt: s.createdAt,
    updatedAt: s.createdAt,
    createdBy: null,
    kind: acquisition ? "acquisition" : "raise",
    company: s.company,
    financials: s.financials,
    diverseOwned: s.ownership.diverseOwned,
    useOfFunds: s.deal.useOfFunds,
    purchasePrice: s.deal.purchasePrice ?? null,
    pieces,
    details: s.deal.details,
    cim: s.cim ?? null,
    naics: s.naics,
    summary: s.ai,
    notes: s.notes.map((n) => ({ at: n.at, by: null, text: n.text })),
    outreach: {},
  };
}
