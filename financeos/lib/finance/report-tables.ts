/**
 * Builds presentation tables for financial statements with period comparisons.
 * Used by the Reports page and CSV exports so both show identical numbers.
 */

import type { BalanceSheetSection, CashFlowSection, FinancialDataset, PnlCategory } from "@/lib/domain/types";
import { formatIsoDate, monthEnd } from "@/lib/domain/dates";
import { pctChange, roundCents } from "@/lib/domain/money";
import { AGING_BUCKETS } from "./aging";
import { receivablesSnapshot } from "./metrics";
import { previousPeriod, samePeriodPriorYear, type Period } from "./periods";
import { computeRatios } from "./ratios";
import {
  BALANCE_SHEET_SECTION_LABELS,
  balanceSheetAt,
  CASH_FLOW_SECTION_LABELS,
  cashFlowForPeriod,
  PNL_CATEGORY_LABELS,
  pnlForPeriod,
  summarizeBalanceSheet,
  type PnlSummary,
} from "./statements";

export type RowKind = "section" | "line" | "subtotal" | "total";

export interface StatementRow {
  label: string;
  kind: RowKind;
  depth: number;
  current: number | null;
  comparison: number | null;
  change: number | null;
  changePct: number | null;
}

export interface StatementTable {
  title: string;
  currentLabel: string;
  comparisonLabel: string | null;
  rows: StatementRow[];
  notes: string[];
}

export type ComparisonMode = "prior-period" | "prior-year" | "none";

function row(label: string, kind: RowKind, depth: number, current: number | null, comparison: number | null): StatementRow {
  const change = current != null && comparison != null ? roundCents(current - comparison) : null;
  return { label, kind, depth, current, comparison, change, changePct: pctChange(current, comparison) };
}

function comparisonPeriod(period: Period, mode: ComparisonMode, fy: number): Period | null {
  if (mode === "none") return null;
  return mode === "prior-period" ? previousPeriod(period, fy) : samePeriodPriorYear(period, fy);
}

function periodLabel(period: Period, summary: { includesPartialMonth: boolean } | null): string {
  return summary?.includesPartialMonth ? `${period.label} (to date)` : period.label;
}

/* ------------------------------------------------------------------ P&L */

export function buildPnlTable(dataset: FinancialDataset, period: Period, mode: ComparisonMode): StatementTable | null {
  const fy = dataset.company.fiscalYearStartMonth;
  const cur = pnlForPeriod(dataset, period);
  if (!cur) return null;
  const cmpPeriod = comparisonPeriod(period, mode, fy);
  const cmp = cmpPeriod ? pnlForPeriod(dataset, cmpPeriod) : null;
  const rows: StatementRow[] = [];
  const amount = (s: PnlSummary | null, cat: PnlCategory, account: string) =>
    s ? (s.lines.find((l) => l.category === cat && l.account === account)?.amount ?? 0) : null;

  const section = (cat: PnlCategory, totalLabel: string, totalKey: keyof PnlSummary) => {
    const accounts = [...new Set([...cur.lines, ...(cmp?.lines ?? [])].filter((l) => l.category === cat).map((l) => l.account))];
    if (accounts.length === 0) return;
    rows.push(row(PNL_CATEGORY_LABELS[cat], "section", 0, null, null));
    for (const a of accounts) rows.push(row(a, "line", 1, amount(cur, cat, a), amount(cmp, cat, a)));
    rows.push(row(totalLabel, "subtotal", 0, cur[totalKey] as number, cmp ? (cmp[totalKey] as number) : null));
  };
  section("income", "Total Income", "revenue");
  section("cogs", "Total Cost of Goods Sold", "cogs");
  rows.push(row("Gross Profit", "total", 0, cur.grossProfit, cmp?.grossProfit ?? null));
  section("expense", "Total Operating Expenses", "operatingExpenses");
  rows.push(row("Operating Income", "total", 0, cur.operatingIncome, cmp?.operatingIncome ?? null));
  section("otherIncome", "Total Other Income", "otherIncome");
  section("otherExpense", "Total Other Expenses", "otherExpense");
  rows.push(row("Net Income", "total", 0, cur.netIncome, cmp?.netIncome ?? null));

  const notes: string[] = [];
  if (cur.includesPartialMonth) notes.push("The current period includes the current month to date, so it is not directly comparable with a full prior period.");
  if (cur.missingMonths.length > 0 && !cur.includesPartialMonth) notes.push(`No data for: ${cur.missingMonths.join(", ")}.`);
  if (cmpPeriod && !cmp) notes.push(`No data is available for the comparison period (${cmpPeriod.label}).`);
  else if (cmp && cmp.missingMonths.length > 0) notes.push(`Comparison period is incomplete: no data for ${cmp.missingMonths.join(", ")}.`);
  return {
    title: "Profit and Loss",
    currentLabel: periodLabel(period, cur),
    comparisonLabel: cmpPeriod ? cmpPeriod.label : null,
    rows,
    notes,
  };
}

/* ------------------------------------------------------------------ Balance sheet */

const BS_ORDER: { group: string; sections: BalanceSheetSection[]; totalKey: "currentAssets" | "totalAssets" | "currentLiabilities" | "totalLiabilities" | "equity" }[] = [
  { group: "Current Assets", sections: ["bank", "accountsReceivable", "otherCurrentAssets"], totalKey: "currentAssets" },
  { group: "Long-Term Assets", sections: ["fixedAssets", "otherAssets"], totalKey: "totalAssets" },
  { group: "Current Liabilities", sections: ["accountsPayable", "creditCards", "otherCurrentLiabilities"], totalKey: "currentLiabilities" },
  { group: "Long-Term Liabilities", sections: ["longTermLiabilities"], totalKey: "totalLiabilities" },
  { group: "Equity", sections: ["equity"], totalKey: "equity" },
];

const BS_TOTAL_LABEL: Record<string, string> = {
  currentAssets: "Total Current Assets",
  totalAssets: "Total Assets",
  currentLiabilities: "Total Current Liabilities",
  totalLiabilities: "Total Liabilities",
  equity: "Total Equity",
};

/** Balance sheet at the end of `period` (or the as-of date for the current period). */
export function buildBalanceSheetTable(dataset: FinancialDataset, period: Period, mode: ComparisonMode): StatementTable | null {
  const fy = dataset.company.fiscalYearStartMonth;
  const endDate = period.endMonth >= dataset.asOfDate.slice(0, 7) ? dataset.asOfDate : monthEnd(period.endMonth);
  const snap = balanceSheetAt(dataset, endDate);
  if (!snap) return null;
  const cmpPeriod = comparisonPeriod(period, mode, fy);
  const cmpSnap = cmpPeriod ? balanceSheetAt(dataset, monthEnd(cmpPeriod.endMonth)) : null;
  const cur = summarizeBalanceSheet(snap);
  const cmp = cmpSnap ? summarizeBalanceSheet(cmpSnap) : null;
  const amount = (s: typeof snap | null, section: BalanceSheetSection, account: string) =>
    s ? (s.lines.find((l) => l.section === section && l.account === account)?.amount ?? 0) : null;
  const rows: StatementRow[] = [];
  rows.push(row("ASSETS", "section", 0, null, null));
  BS_ORDER.forEach((g, gi) => {
    if (gi === 2) {
      rows.push(row("LIABILITIES AND EQUITY", "section", 0, null, null));
    }
    rows.push(row(g.group, "section", 1, null, null));
    for (const section of g.sections) {
      const accounts = [...new Set([...snap.lines, ...(cmpSnap?.lines ?? [])].filter((l) => l.section === section).map((l) => l.account))];
      if (accounts.length === 0) continue;
      if (g.sections.length > 1) rows.push(row(BALANCE_SHEET_SECTION_LABELS[section], "section", 2, null, null));
      for (const a of accounts) rows.push(row(a, "line", g.sections.length > 1 ? 3 : 2, amount(snap, section, a), amount(cmpSnap, section, a)));
    }
    if (g.totalKey === "totalAssets") {
      rows.push(row("Total Long-Term Assets", "subtotal", 1, roundCents(cur.fixedAssets + cur.otherAssets), cmp ? roundCents(cmp.fixedAssets + cmp.otherAssets) : null));
    }
    if (g.totalKey === "totalLiabilities") {
      rows.push(row("Total Long-Term Liabilities", "subtotal", 1, cur.longTermLiabilities, cmp?.longTermLiabilities ?? null));
    }
    rows.push(row(BS_TOTAL_LABEL[g.totalKey], g.totalKey === "currentAssets" || g.totalKey === "currentLiabilities" ? "subtotal" : "total", g.totalKey === "currentAssets" || g.totalKey === "currentLiabilities" ? 1 : 0, cur[g.totalKey], cmp ? cmp[g.totalKey] : null));
  });
  rows.push(row("Total Liabilities and Equity", "total", 0, cur.totalLiabilitiesAndEquity, cmp?.totalLiabilitiesAndEquity ?? null));
  const notes: string[] = [];
  if (!cur.balances) notes.push(`Warning: assets (${cur.totalAssets}) do not equal liabilities plus equity (${cur.totalLiabilitiesAndEquity}) in the source data.`);
  if (cmpPeriod && !cmpSnap) notes.push(`No balance sheet is available for ${cmpPeriod.label}.`);
  return {
    title: "Balance Sheet",
    currentLabel: `As of ${formatIsoDate(snap.date)}`,
    comparisonLabel: cmpSnap ? `As of ${formatIsoDate(cmpSnap.date)}` : cmpPeriod ? cmpPeriod.label : null,
    rows,
    notes,
  };
}

/* ------------------------------------------------------------------ Cash flow */

export function buildCashFlowTable(dataset: FinancialDataset, period: Period, mode: ComparisonMode): StatementTable | null {
  const fy = dataset.company.fiscalYearStartMonth;
  const cur = cashFlowForPeriod(dataset, period);
  if (!cur) return null;
  const cmpPeriod = comparisonPeriod(period, mode, fy);
  const cmp = cmpPeriod ? cashFlowForPeriod(dataset, cmpPeriod) : null;
  const rows: StatementRow[] = [];
  const sections: CashFlowSection[] = ["operating", "investing", "financing"];
  for (const section of sections) {
    const labels = [...new Set([...cur.lines, ...(cmp?.lines ?? [])].filter((l) => l.section === section).map((l) => l.label))];
    rows.push(row(CASH_FLOW_SECTION_LABELS[section], "section", 0, null, null));
    for (const label of labels) {
      const c = cur.lines.find((l) => l.section === section && l.label === label)?.amount ?? 0;
      const p = cmp ? (cmp.lines.find((l) => l.section === section && l.label === label)?.amount ?? 0) : null;
      rows.push(row(label, "line", 1, c, p));
    }
    rows.push(row(`Net cash from ${CASH_FLOW_SECTION_LABELS[section].toLowerCase()}`, "subtotal", 0, cur[section], cmp ? cmp[section] : null));
  }
  rows.push(row("Net change in cash", "total", 0, cur.netChange, cmp?.netChange ?? null));
  rows.push(row("Cash at beginning of period", "line", 0, cur.beginningCash, cmp?.beginningCash ?? null));
  rows.push(row("Cash at end of period", "total", 0, cur.endingCash, cmp?.endingCash ?? null));
  const notes: string[] = [];
  if (cur.includesPartialMonth) notes.push("Includes the current month to date.");
  if (cmpPeriod && !cmp) notes.push(`No cash flow data for ${cmpPeriod.label}.`);
  if (cur.beginningCash != null && cur.endingCash != null && Math.abs(cur.beginningCash + cur.netChange - cur.endingCash) > 1) {
    notes.push("Beginning cash plus net change does not equal ending cash in the source report; differences can come from accounts QuickBooks classifies outside the cash flow statement.");
  }
  return { title: "Statement of Cash Flows", currentLabel: periodLabel(period, cur), comparisonLabel: cmpPeriod?.label ?? null, rows, notes };
}

/* ------------------------------------------------------------------ AR aging */

export interface AgingTable {
  asOfDate: string;
  columns: string[];
  rows: { customer: string; values: number[]; total: number }[];
  totals: number[];
  grandTotal: number;
}

export function buildAgingTable(dataset: FinancialDataset): AgingTable | null {
  const ar = receivablesSnapshot(dataset);
  if (!ar) return null;
  return {
    asOfDate: dataset.asOfDate,
    columns: AGING_BUCKETS.map((b) => b.label),
    rows: ar.customers.map((c) => ({ customer: c.customerName, values: AGING_BUCKETS.map((b) => c.buckets[b.key]), total: c.total })),
    totals: AGING_BUCKETS.map((b) => ar.aging.buckets[b.key].amount),
    grandTotal: ar.aging.total,
  };
}

export function ratiosTable(dataset: FinancialDataset) {
  return computeRatios(dataset);
}
