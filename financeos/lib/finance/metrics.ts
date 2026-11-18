/**
 * Headline metrics used by the dashboard, reports and AI CFO.
 */

import type { FinancialDataset } from "@/lib/domain/types";
import { addDays, monthLabel } from "@/lib/domain/dates";
import { pctChange, roundCents, safeDivide, sum } from "@/lib/domain/money";
import {
  collectionsPriorities,
  customerBalances,
  invoicesAsOfEarlierDate,
  openBillsAsOf,
  openInvoicesAsOf,
  summarizeAging,
  summarizePayables,
  type AgingSummary,
  type CollectionsPriority,
  type CustomerBalance,
  type OpenInvoice,
  type PayablesSummary,
} from "./aging";
import { computeRatios, findRatio, type Ratio } from "./ratios";
import {
  closedPnlMonths,
  latestBalanceSheet,
  summarizeBalanceSheet,
  summarizePnl,
  trailingClosedMonths,
  type PnlSummary,
} from "./statements";

/* ------------------------------------------------------------------ cash */

export interface CashPosition {
  amount: number;
  asOfDate: string;
  basis: "balance-sheet" | "bank-account-balances";
  accounts: { name: string; balance: number }[];
  /** Always shown with the figure: this is the accounting book balance, not a live bank feed. */
  caveat: string;
}

export function cashPosition(dataset: FinancialDataset): CashPosition | null {
  const caveat =
    dataset.source === "demo"
      ? "Fictional demo book balance."
      : "Book balance of bank accounts in QuickBooks. It is not a live bank balance and may exclude uncleared or unrecorded transactions.";
  const snap = dataset.coverage.balanceSheet ? latestBalanceSheet(dataset) : null;
  if (snap && snap.date === dataset.asOfDate) {
    const bank = snap.lines.filter((l) => l.section === "bank");
    if (bank.length > 0) {
      return {
        amount: sum(bank.map((l) => l.amount)),
        asOfDate: snap.date,
        basis: "balance-sheet",
        accounts: bank.map((l) => ({ name: l.account, balance: l.amount })),
        caveat,
      };
    }
  }
  const banks = dataset.accounts.filter((a) => a.type === "Bank" && a.active && a.currentBalance != null);
  if (dataset.coverage.accounts && banks.length > 0) {
    return {
      amount: sum(banks.map((a) => a.currentBalance ?? 0)),
      asOfDate: dataset.asOfDate,
      basis: "bank-account-balances",
      accounts: banks.map((a) => ({ name: a.name, balance: a.currentBalance ?? 0 })),
      caveat,
    };
  }
  return null;
}

/* ------------------------------------------------------------------ receivables */

export interface ReceivablesSnapshot {
  open: OpenInvoice[];
  aging: AgingSummary;
  customers: CustomerBalance[];
  priorities: CollectionsPriority[];
}

export function receivablesSnapshot(dataset: FinancialDataset, asOfDate = dataset.asOfDate): ReceivablesSnapshot | null {
  if (!dataset.coverage.invoices) return null;
  const open = openInvoicesAsOf(dataset.invoices, asOfDate);
  const customers = customerBalances(open);
  return { open, aging: summarizeAging(open, asOfDate), customers, priorities: collectionsPriorities(customers) };
}

/** Overdue AR at an earlier date, reconstructed from recorded payments. */
export function overdueTrend(dataset: FinancialDataset, daysBack: number[] = [60, 30, 0]): { date: string; overdue: number; total: number }[] | null {
  if (!dataset.coverage.invoices || !dataset.coverage.payments) return null;
  return daysBack.map((d) => {
    const date = addDays(dataset.asOfDate, -d);
    const invs = d === 0 ? dataset.invoices : invoicesAsOfEarlierDate(dataset.invoices, dataset.payments, date);
    const open = openInvoicesAsOf(invs, date);
    const aging = summarizeAging(open, date);
    return { date, overdue: aging.overdueAmount, total: aging.total };
  });
}

export function payablesSnapshot(dataset: FinancialDataset): PayablesSummary | null {
  if (!dataset.coverage.bills) return null;
  return summarizePayables(openBillsAsOf(dataset.bills, dataset.asOfDate), dataset.asOfDate);
}

/* ------------------------------------------------------------------ periods */

export interface MonthComparison {
  month: string;
  label: string;
  current: PnlSummary;
  prior: PnlSummary | null;
  priorMonth: string | null;
  revenueChange: number | null;
  expenseChange: number | null;
  netIncomeChange: number | null;
}

/** The last closed month compared with the month before it. */
export function lastClosedMonthComparison(dataset: FinancialDataset): MonthComparison | null {
  if (!dataset.coverage.profitAndLoss) return null;
  const closed = closedPnlMonths(dataset);
  if (closed.length === 0) return null;
  const last = closed[closed.length - 1];
  const prev = closed.length > 1 ? closed[closed.length - 2] : null;
  const current = summarizePnl([last]);
  const prior = prev ? summarizePnl([prev]) : null;
  return {
    month: last.month,
    label: monthLabel(last.month, "long"),
    current,
    prior,
    priorMonth: prev?.month ?? null,
    revenueChange: prior ? pctChange(current.revenue, prior.revenue) : null,
    expenseChange: prior ? pctChange(current.totalExpenses, prior.totalExpenses) : null,
    netIncomeChange: prior ? pctChange(current.netIncome, prior.netIncome) : null,
  };
}

export function trailingTwelveMonths(dataset: FinancialDataset): (PnlSummary & { monthCount: number }) | null {
  if (!dataset.coverage.profitAndLoss) return null;
  const months = trailingClosedMonths(dataset, 12);
  if (months.length === 0) return null;
  return { ...summarizePnl(months), monthCount: months.length };
}

/* ------------------------------------------------------------------ expenses */

export interface ExpenseChange {
  account: string;
  category: "cogs" | "expense" | "otherExpense";
  lastMonth: number;
  priorMonth: number;
  /** Average of the three closed months before the last closed month. */
  baselineAverage: number | null;
  changeVsPrior: number;
  pctVsPrior: number | null;
  pctVsBaseline: number | null;
  significant: boolean;
}

export const EXPENSE_CHANGE_THRESHOLD = { pct: 0.15, amount: 2_500 };

/**
 * Compares each expense account in the last closed month with the prior month
 * and with the average of the three months before it. "Significant" means the
 * increase is at least 15% and at least $2,500 versus both comparisons.
 */
export function expenseChanges(dataset: FinancialDataset): { month: string; priorMonth: string; changes: ExpenseChange[] } | null {
  if (!dataset.coverage.profitAndLoss) return null;
  const closed = closedPnlMonths(dataset);
  if (closed.length < 2) return null;
  const last = closed[closed.length - 1];
  const prior = closed[closed.length - 2];
  const baselineMonths = closed.slice(Math.max(0, closed.length - 4), closed.length - 1);
  const accounts = new Map<string, ExpenseChange["category"]>();
  for (const m of [last, prior, ...baselineMonths]) {
    for (const l of m.lines) if (l.category !== "income" && l.category !== "otherIncome") accounts.set(l.account, l.category);
  }
  const amountIn = (m: (typeof closed)[number], account: string) =>
    sum(m.lines.filter((l) => l.account === account && l.category !== "income" && l.category !== "otherIncome").map((l) => l.amount));
  const changes: ExpenseChange[] = [...accounts.entries()].map(([account, category]) => {
    const lastMonth = amountIn(last, account);
    const priorMonth = amountIn(prior, account);
    const baselineAverage =
      baselineMonths.length > 0 ? roundCents(sum(baselineMonths.map((m) => amountIn(m, account))) / baselineMonths.length) : null;
    const changeVsPrior = roundCents(lastMonth - priorMonth);
    const pctVsPrior = pctChange(lastMonth, priorMonth);
    const pctVsBaseline = pctChange(lastMonth, baselineAverage);
    const significant =
      changeVsPrior >= EXPENSE_CHANGE_THRESHOLD.amount &&
      (pctVsPrior ?? 0) >= EXPENSE_CHANGE_THRESHOLD.pct &&
      (baselineAverage == null || (pctVsBaseline ?? 0) >= EXPENSE_CHANGE_THRESHOLD.pct);
    return { account, category, lastMonth, priorMonth, baselineAverage, changeVsPrior, pctVsPrior, pctVsBaseline, significant };
  });
  changes.sort((a, b) => b.changeVsPrior - a.changeVsPrior);
  return { month: last.month, priorMonth: prior.month, changes };
}

/* ------------------------------------------------------------------ health */

export type HealthStatus = "good" | "watch" | "concern" | "unavailable";

export interface HealthIndicator {
  id: string;
  name: string;
  status: HealthStatus;
  value: number | null;
  format: Ratio["format"];
  summary: string;
  rule: string;
}

function grade(value: number | null, goodIf: (v: number) => boolean, watchIf: (v: number) => boolean): HealthStatus {
  if (value == null) return "unavailable";
  if (goodIf(value)) return "good";
  if (watchIf(value)) return "watch";
  return "concern";
}

export function healthIndicators(dataset: FinancialDataset, ratios: Ratio[] = computeRatios(dataset)): HealthIndicator[] {
  const ar = receivablesSnapshot(dataset);
  const current = findRatio(ratios, "current-ratio")?.value ?? null;
  const coverage = findRatio(ratios, "cash-coverage")?.value ?? null;
  const netMargin = findRatio(ratios, "net-margin")?.value ?? null;
  const dso = findRatio(ratios, "dso")?.value ?? null;
  const over60Share = ar ? safeDivide(ar.aging.over60Amount, ar.aging.total) : null;
  const topShare = ar && ar.customers.length > 0 ? ar.customers[0].shareOfTotal : null;

  return [
    {
      id: "liquidity",
      name: "Liquidity",
      value: current,
      format: "ratio",
      status: grade(current, (v) => v >= 1.5, (v) => v >= 1.0),
      summary: current == null ? "Not available" : `Current ratio ${current.toFixed(2)}x`,
      rule: "Good at 1.5x or higher, watch from 1.0x to 1.5x, concern below 1.0x.",
    },
    {
      id: "cash-coverage",
      name: "Cash cushion",
      value: coverage,
      format: "months",
      status: grade(coverage, (v) => v >= 2, (v) => v >= 1),
      summary: coverage == null ? "Not available" : `${coverage.toFixed(1)} months of expenses in cash`,
      rule: "Good at 2+ months of average expenses, watch at 1-2 months, concern below 1 month.",
    },
    {
      id: "collections",
      name: "Collections",
      value: over60Share,
      format: "percent",
      status: grade(over60Share, (v) => v < 0.05, (v) => v < 0.15),
      summary:
        over60Share == null
          ? "Not available"
          : `${(over60Share * 100).toFixed(1)}% of AR over 60 days late${dso != null ? `, DSO ${Math.round(dso)} days` : ""}`,
      rule: "Good when under 5% of receivables are more than 60 days overdue, watch from 5% to 15%, concern above 15%.",
    },
    {
      id: "profitability",
      name: "Profitability",
      value: netMargin,
      format: "percent",
      status: grade(netMargin, (v) => v >= 0.08, (v) => v >= 0.03),
      summary: netMargin == null ? "Not available" : `Net margin ${(netMargin * 100).toFixed(1)}% (trailing 12 months)`,
      rule: "Good at 8%+ net margin, watch from 3% to 8%, concern below 3%.",
    },
    {
      id: "concentration",
      name: "Customer concentration",
      value: topShare,
      format: "percent",
      status: grade(topShare, (v) => v < 0.2, (v) => v < 0.35),
      summary:
        topShare == null || !ar
          ? "Not available"
          : `${ar.customers[0].customerName} is ${(topShare * 100).toFixed(1)}% of receivables`,
      rule: "Good when the largest customer is under 20% of receivables, watch from 20% to 35%, concern above 35%.",
    },
  ];
}

/* ------------------------------------------------------------------ snapshot */

export function balanceSheetSummaryLatest(dataset: FinancialDataset) {
  const snap = dataset.coverage.balanceSheet ? latestBalanceSheet(dataset) : null;
  return snap ? summarizeBalanceSheet(snap) : null;
}

/* ------------------------------------------------------------------ expense drivers */

export interface VendorDriver {
  vendorName: string;
  lastMonth: number;
  priorMonth: number;
  change: number;
  billCount: number;
}

export interface ExpenseDrivers {
  account: string;
  month: string;
  priorMonth: string;
  /** Total of vendor bills coded to this account in each month. */
  billedLastMonth: number;
  billedPriorMonth: number;
  /** Share of the account's change explained by vendor bills (0-1), when the account changed. */
  explainedShare: number | null;
  vendors: VendorDriver[];
}

function accountKey(name: string): string {
  // QuickBooks bill lines use full names like "Job Expenses:Job Materials"; P&L rows use the leaf name.
  const leaf = name.split(":").pop() ?? name;
  return leaf.trim().toLowerCase();
}

/**
 * Which vendors' bills drive the change in an expense account between two
 * months. Recorded facts only: it does not explain non-bill expenses
 * (payroll, card charges, journal entries).
 */
export function expenseDrivers(dataset: FinancialDataset, account: string, month: string, priorMonth: string, accountChange: number | null = null): ExpenseDrivers | null {
  if (!dataset.coverage.bills) return null;
  const key = accountKey(account);
  const inMonth = (d: string, m: string) => d.slice(0, 7) === m;
  const relevant = dataset.bills.filter((b) => b.category && accountKey(b.category) === key && (inMonth(b.txnDate, month) || inMonth(b.txnDate, priorMonth)));
  if (relevant.length === 0) return null;
  const by = new Map<string, VendorDriver>();
  for (const b of relevant) {
    const v = by.get(b.vendorName) ?? { vendorName: b.vendorName, lastMonth: 0, priorMonth: 0, change: 0, billCount: 0 };
    if (inMonth(b.txnDate, month)) v.lastMonth = roundCents(v.lastMonth + b.totalAmount);
    else v.priorMonth = roundCents(v.priorMonth + b.totalAmount);
    v.billCount += 1;
    by.set(b.vendorName, v);
  }
  const vendors = [...by.values()].map((v) => ({ ...v, change: roundCents(v.lastMonth - v.priorMonth) })).sort((a, b) => Math.abs(b.change) - Math.abs(a.change));
  const billedLastMonth = sum(vendors.map((v) => v.lastMonth));
  const billedPriorMonth = sum(vendors.map((v) => v.priorMonth));
  const billedChange = billedLastMonth - billedPriorMonth;
  return {
    account,
    month,
    priorMonth,
    billedLastMonth,
    billedPriorMonth,
    explainedShare: accountChange ? Math.max(0, Math.min(1, billedChange / accountChange)) : null,
    vendors,
  };
}
