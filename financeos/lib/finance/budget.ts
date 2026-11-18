/**
 * Budget vs. actual.
 *
 * A budget is a set of P&L accounts with an annual amount spread across the
 * fiscal year's months. FinanceOS can draft one from last year's actuals plus
 * growth assumptions (keeping each account's monthly pattern); the owner can
 * then edit annual amounts. Variances are computed deterministically.
 */

import { z } from "zod";
import type { FinancialDataset, PnlCategory } from "@/lib/domain/types";
import { addMonths, monthRange } from "@/lib/domain/dates";
import { roundCents, safeDivide, sum } from "@/lib/domain/money";
import { periodContaining } from "./periods";

export const BudgetLineSchema = z.object({
  account: z.string().min(1).max(200),
  category: z.enum(["income", "cogs", "expense", "otherIncome", "otherExpense"]),
  annual: z.number().finite().min(-1e11).max(1e11),
  monthly: z.record(z.string().regex(/^\d{4}-\d{2}$/), z.number().finite()),
});

export const BudgetSchema = z.object({
  fiscalYearLabel: z.string().max(20),
  startMonth: z.string().regex(/^\d{4}-\d{2}$/),
  months: z.array(z.string().regex(/^\d{4}-\d{2}$/)).length(12),
  lines: z.array(BudgetLineSchema).max(500),
  method: z.string().max(300),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type BudgetLine = z.infer<typeof BudgetLineSchema>;
export type Budget = z.infer<typeof BudgetSchema>;

export interface GrowthAssumptions {
  /** e.g. 0.08 for +8% */
  income: number;
  expense: number;
}

const INCOME_LIKE: PnlCategory[] = ["income", "otherIncome"];

/** Spread an annual amount across months following a pattern (weights); even split when the pattern is empty. */
export function spread(annual: number, months: string[], pattern: Record<string, number>): Record<string, number> {
  const weights = months.map((m) => Math.max(0, pattern[m] ?? 0));
  const total = weights.reduce((a, b) => a + b, 0);
  const out: Record<string, number> = {};
  let allocated = 0;
  months.forEach((m, i) => {
    if (i === months.length - 1) {
      out[m] = roundCents(annual - allocated);
      return;
    }
    const v = roundCents(total > 0 ? (annual * weights[i]) / total : annual / months.length);
    out[m] = v;
    allocated = roundCents(allocated + v);
  });
  return out;
}

/** The fiscal year containing the dataset's as-of date. */
export function currentFiscalYear(ds: FinancialDataset): { label: string; startMonth: string; months: string[] } {
  const p = periodContaining(ds.asOfDate.slice(0, 7), "year", ds.company.fiscalYearStartMonth);
  return { label: p.label, startMonth: p.startMonth, months: monthRange(p.startMonth, p.endMonth) };
}

/**
 * Draft a budget for the current fiscal year from the prior year's actuals.
 * Each account keeps last year's monthly pattern; months without history use
 * the account's average of the available months.
 */
export function draftBudgetFromHistory(ds: FinancialDataset, growth: GrowthAssumptions, now = new Date().toISOString()): Budget {
  const fy = currentFiscalYear(ds);
  const closed = ds.monthlyPnl.filter((m) => !m.isPartial);
  const accounts = new Map<string, { category: PnlCategory; prior: Record<string, number> }>();
  for (const target of fy.months) {
    const src = addMonths(target, -12);
    const m = closed.find((x) => x.month === src);
    for (const l of m?.lines ?? []) {
      const key = `${l.category}|${l.account}`;
      const a = accounts.get(key) ?? { category: l.category, prior: {} };
      a.prior[target] = roundCents((a.prior[target] ?? 0) + l.amount);
      accounts.set(key, a);
    }
  }
  const lines: BudgetLine[] = [];
  for (const [key, a] of accounts) {
    const account = key.split("|").slice(1).join("|");
    const known = Object.values(a.prior);
    const avg = known.length ? known.reduce((x, y) => x + y, 0) / known.length : 0;
    const filled: Record<string, number> = {};
    for (const m of fy.months) filled[m] = a.prior[m] ?? avg;
    const g = INCOME_LIKE.includes(a.category) ? growth.income : growth.expense;
    const annual = roundCents(sum(Object.values(filled)) * (1 + g));
    lines.push({ account, category: a.category, annual, monthly: spread(annual, fy.months, filled) });
  }
  const order: PnlCategory[] = ["income", "cogs", "expense", "otherIncome", "otherExpense"];
  lines.sort((x, y) => order.indexOf(x.category) - order.indexOf(y.category) || x.account.localeCompare(y.account));
  return {
    fiscalYearLabel: fy.label,
    startMonth: fy.startMonth,
    months: fy.months,
    lines,
    method: `Drafted from the prior year's actuals, keeping each account's monthly pattern, with income ${growth.income >= 0 ? "+" : ""}${Math.round(growth.income * 1000) / 10}% and expenses ${growth.expense >= 0 ? "+" : ""}${Math.round(growth.expense * 1000) / 10}%.`,
    createdAt: now,
    updatedAt: now,
  };
}

/** Change a line's annual amount, re-spreading it with the line's existing monthly pattern. */
export function setAnnual(budget: Budget, account: string, category: PnlCategory, annual: number, now = new Date().toISOString()): Budget {
  return {
    ...budget,
    updatedAt: now,
    lines: budget.lines.map((l) => (l.account === account && l.category === category ? { ...l, annual: roundCents(annual), monthly: spread(roundCents(annual), budget.months, l.monthly) } : l)),
  };
}

export interface VarianceRow {
  account: string;
  category: PnlCategory;
  budget: number;
  actual: number;
  variance: number;
  variancePct: number | null;
  /** Income above budget and costs below budget are favorable. */
  favorable: boolean | null;
}

export interface VarianceTotals {
  revenueBudget: number;
  revenueActual: number;
  netIncomeBudget: number;
  netIncomeActual: number;
  costsBudget: number;
  costsActual: number;
}

export interface BudgetVariance {
  months: string[];
  /** Months in the period with closed actuals. */
  actualMonths: string[];
  rows: VarianceRow[];
  totals: VarianceTotals;
}

const SIGN: Record<PnlCategory, 1 | -1> = { income: 1, otherIncome: 1, cogs: -1, expense: -1, otherExpense: -1 };

/** Compare budget to actuals over the given months (only closed months are compared). */
export function budgetVsActual(ds: FinancialDataset, budget: Budget, months: string[]): BudgetVariance {
  const closed = new Set(ds.monthlyPnl.filter((m) => !m.isPartial).map((m) => m.month));
  const actualMonths = months.filter((m) => closed.has(m) && budget.months.includes(m));
  const actualByKey = new Map<string, number>();
  for (const m of ds.monthlyPnl.filter((x) => actualMonths.includes(x.month))) {
    for (const l of m.lines) actualByKey.set(`${l.category}|${l.account}`, roundCents((actualByKey.get(`${l.category}|${l.account}`) ?? 0) + l.amount));
  }
  const keys = new Set<string>([...budget.lines.map((l) => `${l.category}|${l.account}`), ...actualByKey.keys()]);
  const rows: VarianceRow[] = [...keys].map((key) => {
    const [category, ...rest] = key.split("|") as [PnlCategory, ...string[]];
    const account = rest.join("|");
    const line = budget.lines.find((l) => l.category === category && l.account === account);
    const b = line ? sum(actualMonths.map((m) => line.monthly[m] ?? 0)) : 0;
    const a = actualByKey.get(key) ?? 0;
    const variance = roundCents(a - b);
    return { account, category, budget: b, actual: a, variance, variancePct: safeDivide(variance, Math.abs(b)), favorable: variance === 0 ? null : (variance > 0) === (SIGN[category] === 1) };
  });
  const order: PnlCategory[] = ["income", "cogs", "expense", "otherIncome", "otherExpense"];
  rows.sort((x, y) => order.indexOf(x.category) - order.indexOf(y.category) || Math.abs(y.variance) - Math.abs(x.variance));
  const tot = (pick: (r: VarianceRow) => number, cats: PnlCategory[]) => sum(rows.filter((r) => cats.includes(r.category)).map(pick));
  const costCats: PnlCategory[] = ["cogs", "expense", "otherExpense"];
  const totals: VarianceTotals = {
    revenueBudget: tot((r) => r.budget, ["income"]),
    revenueActual: tot((r) => r.actual, ["income"]),
    costsBudget: tot((r) => r.budget, costCats),
    costsActual: tot((r) => r.actual, costCats),
    netIncomeBudget: roundCents(tot((r) => r.budget, ["income", "otherIncome"]) - tot((r) => r.budget, costCats)),
    netIncomeActual: roundCents(tot((r) => r.actual, ["income", "otherIncome"]) - tot((r) => r.actual, costCats)),
  };
  return { months, actualMonths, rows, totals };
}
