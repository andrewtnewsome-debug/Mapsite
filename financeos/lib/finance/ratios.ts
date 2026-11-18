/**
 * Financial ratios. Each ratio reports its formula and inputs, and returns
 * `value: null` with a reason when the inputs are unavailable, rather than a
 * misleading number.
 */

import type { FinancialDataset } from "@/lib/domain/types";
import { addDays, daysBetween } from "@/lib/domain/dates";
import { roundCents, safeDivide, sum } from "@/lib/domain/money";
import {
  latestBalanceSheet,
  summarizeBalanceSheet,
  summarizePnl,
  trailingClosedMonths,
  type BalanceSheetSummary,
  type PnlSummary,
} from "./statements";

export type RatioFormat = "ratio" | "percent" | "days" | "currency" | "months";

export interface Ratio {
  id: string;
  name: string;
  value: number | null;
  format: RatioFormat;
  formula: string;
  explanation: string;
  /** Why the value is unavailable. */
  unavailableReason?: string;
  inputs: { label: string; value: number | null }[];
}

function ratio(
  base: Omit<Ratio, "value" | "unavailableReason">,
  value: number | null,
  unavailableReason = "Required data is not available.",
): Ratio {
  return value == null || !Number.isFinite(value) ? { ...base, value: null, unavailableReason } : { ...base, value };
}

export interface RatioContext {
  bs: BalanceSheetSummary | null;
  ttm: PnlSummary | null;
  ttmMonths: number;
  trailing3: PnlSummary | null;
  trailing3Days: number | null;
  billsLast90Days: number | null;
}

export function ratioContext(dataset: FinancialDataset): RatioContext {
  const snap = dataset.coverage.balanceSheet ? latestBalanceSheet(dataset) : null;
  const ttmMonths = trailingClosedMonths(dataset, 12);
  const t3 = trailingClosedMonths(dataset, 3);
  const t3Days =
    t3.length > 0 ? daysBetween(addDays(`${t3[0].month}-01`, -1), t3[t3.length - 1].endDate) : null;
  const start90 = addDays(dataset.asOfDate, -90);
  const billsLast90Days = dataset.coverage.bills
    ? sum(dataset.bills.filter((b) => b.txnDate > start90 && b.txnDate <= dataset.asOfDate).map((b) => b.totalAmount))
    : null;
  return {
    bs: snap ? summarizeBalanceSheet(snap) : null,
    ttm: dataset.coverage.profitAndLoss && ttmMonths.length > 0 ? summarizePnl(ttmMonths) : null,
    ttmMonths: ttmMonths.length,
    trailing3: dataset.coverage.profitAndLoss && t3.length > 0 ? summarizePnl(t3) : null,
    trailing3Days: t3Days,
    billsLast90Days,
  };
}

export function computeRatios(dataset: FinancialDataset): Ratio[] {
  const ctx = ratioContext(dataset);
  const { bs, ttm, trailing3 } = ctx;
  const ttmLabel = ctx.ttmMonths === 12 ? "trailing 12 months" : `trailing ${ctx.ttmMonths} months`;
  const noBs = "Balance sheet data is not available.";
  const noPnl = "Profit and loss data is not available.";

  const currentRatio = ratio(
    {
      id: "current-ratio",
      name: "Current ratio",
      format: "ratio",
      formula: "Current assets / Current liabilities",
      explanation: "Ability to cover obligations due within a year with short-term assets. Above 1.5x is generally comfortable.",
      inputs: [
        { label: "Current assets", value: bs?.currentAssets ?? null },
        { label: "Current liabilities", value: bs?.currentLiabilities ?? null },
      ],
    },
    bs ? safeDivide(bs.currentAssets, bs.currentLiabilities) : null,
    bs ? "Current liabilities are zero." : noBs,
  );

  const quickRatio = ratio(
    {
      id: "quick-ratio",
      name: "Quick ratio",
      format: "ratio",
      formula: "(Cash + Accounts receivable) / Current liabilities",
      explanation: "Like the current ratio but only counts cash and receivables.",
      inputs: [
        { label: "Cash", value: bs?.cash ?? null },
        { label: "Accounts receivable", value: bs?.accountsReceivable ?? null },
        { label: "Current liabilities", value: bs?.currentLiabilities ?? null },
      ],
    },
    bs ? safeDivide(bs.cash + bs.accountsReceivable, bs.currentLiabilities) : null,
    bs ? "Current liabilities are zero." : noBs,
  );

  const workingCapital = ratio(
    {
      id: "working-capital",
      name: "Working capital",
      format: "currency",
      formula: "Current assets - Current liabilities",
      explanation: "Short-term resources available after paying short-term obligations.",
      inputs: [
        { label: "Current assets", value: bs?.currentAssets ?? null },
        { label: "Current liabilities", value: bs?.currentLiabilities ?? null },
      ],
    },
    bs ? roundCents(bs.currentAssets - bs.currentLiabilities) : null,
    noBs,
  );

  const margin = (id: string, name: string, num: keyof PnlSummary, label: string, explanation: string) =>
    ratio(
      {
        id,
        name,
        format: "percent",
        formula: `${label} / Revenue (${ttmLabel})`,
        explanation,
        inputs: [
          { label, value: ttm ? (ttm[num] as number) : null },
          { label: "Revenue", value: ttm?.revenue ?? null },
        ],
      },
      ttm ? safeDivide(ttm[num] as number, ttm.revenue) : null,
      ttm ? "Revenue is zero." : noPnl,
    );

  const dso = ratio(
    {
      id: "dso",
      name: "Days sales outstanding (DSO)",
      format: "days",
      formula: "Accounts receivable / (Revenue for last 3 closed months / days in those months)",
      explanation: "Average number of days it takes to collect from customers.",
      inputs: [
        { label: "Accounts receivable", value: bs?.accountsReceivable ?? null },
        { label: "Revenue, last 3 closed months", value: trailing3?.revenue ?? null },
      ],
    },
    bs && trailing3 && ctx.trailing3Days
      ? safeDivide(bs.accountsReceivable, safeDivide(trailing3.revenue, ctx.trailing3Days))
      : null,
    !bs ? noBs : noPnl,
  );

  const dpo = ratio(
    {
      id: "dpo",
      name: "Days payables outstanding (DPO)",
      format: "days",
      formula: "Accounts payable / (Vendor bills entered in last 90 days / 90)",
      explanation: "Average number of days the business takes to pay vendor bills.",
      inputs: [
        { label: "Accounts payable", value: bs?.accountsPayable ?? null },
        { label: "Vendor bills, last 90 days", value: ctx.billsLast90Days },
      ],
    },
    bs && ctx.billsLast90Days ? safeDivide(bs.accountsPayable, ctx.billsLast90Days / 90) : null,
    !bs ? noBs : "Vendor bill data for the last 90 days is not available.",
  );

  const liabilitiesToEquity = ratio(
    {
      id: "liabilities-to-equity",
      name: "Liabilities to equity",
      format: "ratio",
      formula: "Total liabilities / Total equity",
      explanation: "Balance sheet leverage. Lower means less reliance on creditors.",
      inputs: [
        { label: "Total liabilities", value: bs?.totalLiabilities ?? null },
        { label: "Total equity", value: bs?.equity ?? null },
      ],
    },
    bs && bs.equity > 0 ? safeDivide(bs.totalLiabilities, bs.equity) : null,
    bs ? "Equity is zero or negative." : noBs,
  );

  const monthlyExpenses = ttm && ctx.ttmMonths > 0 ? ttm.totalExpenses / ctx.ttmMonths : null;
  const cashCoverage = ratio(
    {
      id: "cash-coverage",
      name: "Months of expenses covered by cash",
      format: "months",
      formula: `Cash / Average monthly total expenses (${ttmLabel})`,
      explanation: "How many months of total costs current cash could cover with no new collections.",
      inputs: [
        { label: "Cash", value: bs?.cash ?? null },
        { label: "Average monthly expenses", value: monthlyExpenses == null ? null : roundCents(monthlyExpenses) },
      ],
    },
    bs && monthlyExpenses ? safeDivide(bs.cash, monthlyExpenses) : null,
    !bs ? noBs : noPnl,
  );

  const interestLine = ttm ? ttm.lines.filter((l) => /interest/i.test(l.account) && l.category === "otherExpense") : [];
  const interest = sum(interestLine.map((l) => l.amount));
  const interestCoverage = ratio(
    {
      id: "interest-coverage",
      name: "Interest coverage",
      format: "ratio",
      formula: `Operating income / Interest expense (${ttmLabel})`,
      explanation: "How many times operating profit covers interest costs.",
      inputs: [
        { label: "Operating income", value: ttm?.operatingIncome ?? null },
        { label: "Interest expense", value: ttm ? interest : null },
      ],
    },
    ttm && interest > 0 ? safeDivide(ttm.operatingIncome, interest) : null,
    ttm ? "No interest expense was recorded." : noPnl,
  );

  return [
    currentRatio,
    quickRatio,
    workingCapital,
    margin("gross-margin", "Gross margin", "grossProfit", "Gross profit", "Revenue left after direct costs of delivering the service."),
    margin("operating-margin", "Operating margin", "operatingIncome", "Operating income", "Profit from operations before interest and other items."),
    margin("net-margin", "Net margin", "netIncome", "Net income", "Bottom-line profit as a share of revenue."),
    dso,
    dpo,
    liabilitiesToEquity,
    cashCoverage,
    interestCoverage,
  ];
}

export function findRatio(ratios: readonly Ratio[], id: string): Ratio | undefined {
  return ratios.find((r) => r.id === id);
}
