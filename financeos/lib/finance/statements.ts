/**
 * Financial statement aggregation: Profit and Loss, Balance Sheet and Cash Flow.
 * Pure functions over the canonical dataset.
 */

import type {
  BalanceSheetSection,
  BalanceSheetSnapshot,
  CashFlowSection,
  FinancialDataset,
  MonthlyCashFlow,
  MonthlyPnl,
  PnlCategory,
} from "@/lib/domain/types";
import { monthLabel } from "@/lib/domain/dates";
import { roundCents, safeDivide, sum } from "@/lib/domain/money";
import { monthsInPeriod, type Period } from "./periods";

/* ------------------------------------------------------------------ P&L */

export interface PnlAccountLine {
  account: string;
  category: PnlCategory;
  amount: number;
}

export interface PnlSummary {
  months: string[];
  /** Months requested but not present in the data. */
  missingMonths: string[];
  includesPartialMonth: boolean;
  revenue: number;
  cogs: number;
  grossProfit: number;
  operatingExpenses: number;
  operatingIncome: number;
  otherIncome: number;
  otherExpense: number;
  netIncome: number;
  /** COGS + operating expenses + other expenses. */
  totalExpenses: number;
  grossMargin: number | null;
  operatingMargin: number | null;
  netMargin: number | null;
  lines: PnlAccountLine[];
}

export const PNL_CATEGORY_LABELS: Record<PnlCategory, string> = {
  income: "Income",
  cogs: "Cost of Goods Sold",
  expense: "Operating Expenses",
  otherIncome: "Other Income",
  otherExpense: "Other Expenses",
};

export function summarizePnl(months: readonly MonthlyPnl[], requestedMonths?: readonly string[]): PnlSummary {
  const byAccount = new Map<string, PnlAccountLine>();
  for (const m of months) {
    for (const l of m.lines) {
      const key = `${l.category}|${l.account}`;
      const existing = byAccount.get(key);
      if (existing) existing.amount = roundCents(existing.amount + l.amount);
      else byAccount.set(key, { account: l.account, category: l.category, amount: roundCents(l.amount) });
    }
  }
  const lines = [...byAccount.values()];
  const total = (cat: PnlCategory) => sum(lines.filter((l) => l.category === cat).map((l) => l.amount));
  const revenue = total("income");
  const cogs = total("cogs");
  const operatingExpenses = total("expense");
  const otherIncome = total("otherIncome");
  const otherExpense = total("otherExpense");
  const grossProfit = roundCents(revenue - cogs);
  const operatingIncome = roundCents(grossProfit - operatingExpenses);
  const netIncome = roundCents(operatingIncome + otherIncome - otherExpense);
  const present = new Set(months.map((m) => m.month));
  return {
    months: months.map((m) => m.month),
    missingMonths: (requestedMonths ?? []).filter((m) => !present.has(m)),
    includesPartialMonth: months.some((m) => m.isPartial),
    revenue,
    cogs,
    grossProfit,
    operatingExpenses,
    operatingIncome,
    otherIncome,
    otherExpense,
    netIncome,
    totalExpenses: roundCents(cogs + operatingExpenses + otherExpense),
    grossMargin: safeDivide(grossProfit, revenue),
    operatingMargin: safeDivide(operatingIncome, revenue),
    netMargin: safeDivide(netIncome, revenue),
    lines,
  };
}

/** P&L for a period, or null when no month of the period is available. */
export function pnlForPeriod(dataset: FinancialDataset, period: Period): PnlSummary | null {
  const wanted = monthsInPeriod(period);
  const months = dataset.monthlyPnl.filter((m) => wanted.includes(m.month));
  if (months.length === 0) return null;
  return summarizePnl(months, wanted);
}

export function closedPnlMonths(dataset: FinancialDataset): MonthlyPnl[] {
  return dataset.monthlyPnl.filter((m) => !m.isPartial);
}

export function lastClosedMonth(dataset: FinancialDataset): MonthlyPnl | null {
  const closed = closedPnlMonths(dataset);
  return closed.length > 0 ? closed[closed.length - 1] : null;
}

/** Trailing N closed months (fewer if not available). */
export function trailingClosedMonths(dataset: FinancialDataset, n: number): MonthlyPnl[] {
  const closed = closedPnlMonths(dataset);
  return closed.slice(Math.max(0, closed.length - n));
}

export interface MonthlyPnlPoint {
  month: string;
  label: string;
  isPartial: boolean;
  revenue: number;
  cogs: number;
  grossProfit: number;
  operatingExpenses: number;
  totalExpenses: number;
  netIncome: number;
  grossMargin: number | null;
  netMargin: number | null;
}

export function monthlyPnlSeries(dataset: FinancialDataset): MonthlyPnlPoint[] {
  return dataset.monthlyPnl.map((m) => {
    const s = summarizePnl([m]);
    return {
      month: m.month,
      label: monthLabel(m.month) + (m.isPartial ? " (MTD)" : ""),
      isPartial: m.isPartial,
      revenue: s.revenue,
      cogs: s.cogs,
      grossProfit: s.grossProfit,
      operatingExpenses: s.operatingExpenses,
      totalExpenses: s.totalExpenses,
      netIncome: s.netIncome,
      grossMargin: s.grossMargin,
      netMargin: s.netMargin,
    };
  });
}

/* ------------------------------------------------------------------ Balance sheet */

export interface BalanceSheetSummary {
  date: string;
  cash: number;
  accountsReceivable: number;
  otherCurrentAssets: number;
  currentAssets: number;
  fixedAssets: number;
  otherAssets: number;
  totalAssets: number;
  accountsPayable: number;
  creditCards: number;
  otherCurrentLiabilities: number;
  currentLiabilities: number;
  longTermLiabilities: number;
  totalLiabilities: number;
  equity: number;
  totalLiabilitiesAndEquity: number;
  /** Assets equal liabilities plus equity within one dollar. */
  balances: boolean;
}

export const BALANCE_SHEET_SECTION_LABELS: Record<BalanceSheetSection, string> = {
  bank: "Bank Accounts",
  accountsReceivable: "Accounts Receivable",
  otherCurrentAssets: "Other Current Assets",
  fixedAssets: "Fixed Assets",
  otherAssets: "Other Assets",
  accountsPayable: "Accounts Payable",
  creditCards: "Credit Cards",
  otherCurrentLiabilities: "Other Current Liabilities",
  longTermLiabilities: "Long-Term Liabilities",
  equity: "Equity",
};

export function summarizeBalanceSheet(snapshot: BalanceSheetSnapshot): BalanceSheetSummary {
  const s = (section: BalanceSheetSection) => sum(snapshot.lines.filter((l) => l.section === section).map((l) => l.amount));
  const cash = s("bank");
  const accountsReceivable = s("accountsReceivable");
  const otherCurrentAssets = s("otherCurrentAssets");
  const currentAssets = roundCents(cash + accountsReceivable + otherCurrentAssets);
  const fixedAssets = s("fixedAssets");
  const otherAssets = s("otherAssets");
  const totalAssets = roundCents(currentAssets + fixedAssets + otherAssets);
  const accountsPayable = s("accountsPayable");
  const creditCards = s("creditCards");
  const otherCurrentLiabilities = s("otherCurrentLiabilities");
  const currentLiabilities = roundCents(accountsPayable + creditCards + otherCurrentLiabilities);
  const longTermLiabilities = s("longTermLiabilities");
  const totalLiabilities = roundCents(currentLiabilities + longTermLiabilities);
  const equity = s("equity");
  const totalLiabilitiesAndEquity = roundCents(totalLiabilities + equity);
  return {
    date: snapshot.date,
    cash,
    accountsReceivable,
    otherCurrentAssets,
    currentAssets,
    fixedAssets,
    otherAssets,
    totalAssets,
    accountsPayable,
    creditCards,
    otherCurrentLiabilities,
    currentLiabilities,
    longTermLiabilities,
    totalLiabilities,
    equity,
    totalLiabilitiesAndEquity,
    balances: Math.abs(totalAssets - totalLiabilitiesAndEquity) < 1,
  };
}

/** Latest snapshot dated on or before `date`. */
export function balanceSheetAt(dataset: FinancialDataset, date: string): BalanceSheetSnapshot | null {
  let found: BalanceSheetSnapshot | null = null;
  for (const s of dataset.balanceSheets) if (s.date <= date) found = s;
  return found;
}

export function latestBalanceSheet(dataset: FinancialDataset): BalanceSheetSnapshot | null {
  return balanceSheetAt(dataset, dataset.asOfDate);
}

/* ------------------------------------------------------------------ Cash flow */

export interface CashFlowLineTotal {
  section: CashFlowSection;
  label: string;
  amount: number;
}

export interface CashFlowSummary {
  months: string[];
  includesPartialMonth: boolean;
  operating: number;
  investing: number;
  financing: number;
  netChange: number;
  beginningCash: number | null;
  endingCash: number | null;
  lines: CashFlowLineTotal[];
}

export const CASH_FLOW_SECTION_LABELS: Record<CashFlowSection, string> = {
  operating: "Operating Activities",
  investing: "Investing Activities",
  financing: "Financing Activities",
};

export function summarizeCashFlow(months: readonly MonthlyCashFlow[]): CashFlowSummary {
  const sorted = [...months].sort((a, b) => (a.month < b.month ? -1 : 1));
  const byLabel = new Map<string, CashFlowLineTotal>();
  for (const m of sorted) {
    for (const l of m.lines) {
      const key = `${l.section}|${l.label}`;
      const existing = byLabel.get(key);
      if (existing) existing.amount = roundCents(existing.amount + l.amount);
      else byLabel.set(key, { ...l, amount: roundCents(l.amount) });
    }
  }
  const lines = [...byLabel.values()];
  const s = (section: CashFlowSection) => sum(lines.filter((l) => l.section === section).map((l) => l.amount));
  const operating = s("operating");
  const investing = s("investing");
  const financing = s("financing");
  return {
    months: sorted.map((m) => m.month),
    includesPartialMonth: sorted.some((m) => m.isPartial),
    operating,
    investing,
    financing,
    netChange: roundCents(operating + investing + financing),
    beginningCash: sorted.length ? sorted[0].beginningCash : null,
    endingCash: sorted.length ? sorted[sorted.length - 1].endingCash : null,
    lines,
  };
}

export function cashFlowForPeriod(dataset: FinancialDataset, period: Period): CashFlowSummary | null {
  const wanted = monthsInPeriod(period);
  const months = dataset.monthlyCashFlow.filter((m) => wanted.includes(m.month));
  if (months.length === 0) return null;
  return summarizeCashFlow(months);
}

export interface MonthlyCashPoint {
  month: string;
  label: string;
  isPartial: boolean;
  operating: number;
  investing: number;
  financing: number;
  netChange: number;
  beginningCash: number | null;
  endingCash: number | null;
  /** Customer payments recorded in the month (actual receipts). null when payments are not available. */
  collections: number | null;
  /** Derived: collections minus net change in cash. null when either input is unavailable. */
  derivedOutflows: number | null;
}

export function monthlyCashSeries(dataset: FinancialDataset): MonthlyCashPoint[] {
  const collectionsByMonth = new Map<string, number>();
  if (dataset.coverage.payments) {
    for (const p of dataset.payments) {
      const m = p.txnDate.slice(0, 7);
      collectionsByMonth.set(m, roundCents((collectionsByMonth.get(m) ?? 0) + p.amount));
    }
  }
  return dataset.monthlyCashFlow.map((m) => {
    const s = summarizeCashFlow([m]);
    const collections = dataset.coverage.payments ? (collectionsByMonth.get(m.month) ?? 0) : null;
    return {
      month: m.month,
      label: monthLabel(m.month) + (m.isPartial ? " (MTD)" : ""),
      isPartial: m.isPartial,
      operating: s.operating,
      investing: s.investing,
      financing: s.financing,
      netChange: s.netChange,
      beginningCash: m.beginningCash,
      endingCash: m.endingCash,
      collections,
      derivedOutflows: collections == null ? null : roundCents(collections - s.netChange),
    };
  });
}
