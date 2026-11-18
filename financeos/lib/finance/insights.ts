/**
 * Deterministic financial insights.
 *
 * Each insight is triggered by a documented threshold and carries its
 * supporting numbers, separated into:
 *   facts        - figures read or calculated from the accounting data
 *   forecasts    - results of the 13-week forecast math
 *   assumptions  - inputs the user or FinanceOS assumed
 * Any plain-English explanation from the local AI model is added separately
 * and labeled as AI interpretation in the UI.
 */

import type { FinancialDataset } from "@/lib/domain/types";
import { addDays, addMonths, formatIsoDate, monthLabel } from "@/lib/domain/dates";
import { pctChange, safeDivide, sum } from "@/lib/domain/money";
import { formatCurrency, formatPercent, formatSignedPercent } from "@/lib/format";
import { runForecast, deriveForecastDefaults } from "./forecast";
import { expenseChanges, overdueTrend, receivablesSnapshot } from "./metrics";
import { balanceSheetAt, closedPnlMonths, summarizeBalanceSheet, summarizePnl } from "./statements";

export type InsightSeverity = "positive" | "info" | "watch" | "concern";
export type InsightCategory = "receivables" | "expenses" | "revenue" | "cash" | "working-capital" | "profitability";

export interface InsightFact {
  label: string;
  value: string;
}

export interface Insight {
  id: string;
  title: string;
  severity: InsightSeverity;
  category: InsightCategory;
  facts: InsightFact[];
  forecasts: string[];
  assumptions: string[];
  /** The rule that produced this insight. */
  trigger: string;
  /** A question the user can ask the AI CFO for more detail. */
  followUpQuestion: string;
}

export const INSIGHT_THRESHOLDS = {
  topCustomerWatch: 0.2,
  topCustomerConcern: 0.35,
  overdueIncreasePct: 0.15,
  overdueIncreaseAmount: 10_000,
  revenueTrendPct: 0.05,
  grossMarginDropPts: 0.02,
  workingCapitalGapPts: 0.1,
};

const SEVERITY_ORDER: Record<InsightSeverity, number> = { concern: 0, watch: 1, info: 2, positive: 3 };

export function generateInsights(dataset: FinancialDataset): Insight[] {
  const insights: Insight[] = [];
  const ar = receivablesSnapshot(dataset);
  const t = INSIGHT_THRESHOLDS;

  // 1. Receivables concentration
  if (ar && ar.customers.length > 0 && ar.aging.total > 0) {
    const top = ar.customers[0];
    const top3Share = safeDivide(sum(ar.customers.slice(0, 3).map((c) => c.total)), ar.aging.total);
    if ((top.shareOfTotal ?? 0) >= t.topCustomerWatch) {
      insights.push({
        id: "ar-concentration",
        title: `${top.customerName} accounts for ${formatPercent(top.shareOfTotal)} of receivables`,
        severity: (top.shareOfTotal ?? 0) >= t.topCustomerConcern ? "concern" : "watch",
        category: "receivables",
        facts: [
          { label: `${top.customerName} open balance`, value: formatCurrency(top.total) },
          { label: "Of which overdue", value: formatCurrency(top.overdue) },
          { label: "Total receivables", value: formatCurrency(ar.aging.total) },
          { label: "Top 3 customers share", value: formatPercent(top3Share) },
        ],
        forecasts: [],
        assumptions: [],
        trigger: `Largest customer is at least ${formatPercent(t.topCustomerWatch, 0)} of total receivables (concern at ${formatPercent(t.topCustomerConcern, 0)}).`,
        followUpQuestion: `How much does ${top.customerName} owe us and how late are they?`,
      });
    }
  }

  // 2. Overdue receivables trend
  const trend = overdueTrend(dataset, [30, 0]);
  if (trend && trend.length === 2) {
    const [before, now] = trend;
    const change = now.overdue - before.overdue;
    const pct = pctChange(now.overdue, before.overdue);
    if (change >= t.overdueIncreaseAmount && (pct == null || pct >= t.overdueIncreasePct)) {
      insights.push({
        id: "overdue-increase",
        title: `Overdue receivables up ${formatCurrency(change)} in 30 days`,
        severity: pct != null && pct >= 0.4 ? "concern" : "watch",
        category: "receivables",
        facts: [
          { label: `Overdue on ${formatIsoDate(before.date)}`, value: formatCurrency(before.overdue) },
          { label: `Overdue on ${formatIsoDate(now.date)}`, value: formatCurrency(now.overdue) },
          { label: "Change", value: `${formatCurrency(change)} (${formatSignedPercent(pct)})` },
        ],
        forecasts: [],
        assumptions: ["Earlier overdue balance is reconstructed from recorded customer payments."],
        trigger: `Overdue balance increased by at least ${formatCurrency(t.overdueIncreaseAmount)} and ${formatPercent(t.overdueIncreasePct, 0)} versus 30 days earlier.`,
        followUpQuestion: "Which customers should we prioritize for collections?",
      });
    }
  }

  // 3. Severely overdue invoices
  if (ar && ar.aging.over90Amount > 0) {
    const old = ar.open.filter((i) => i.bucket === "90+");
    insights.push({
      id: "over-90",
      title: `${old.length} invoice${old.length === 1 ? " is" : "s are"} more than 90 days overdue`,
      severity: "concern",
      category: "receivables",
      facts: [
        { label: "Balance over 90 days", value: formatCurrency(ar.aging.over90Amount) },
        ...old.slice(0, 3).map((i) => ({ label: `${i.customerName} #${i.docNumber ?? i.id}`, value: `${formatCurrency(i.balance)}, ${i.daysOverdue} days overdue` })),
      ],
      forecasts: [],
      assumptions: [],
      trigger: "Any open invoice balance more than 90 days past its due date.",
      followUpQuestion: "How much of our AR is over 60 days old?",
    });
  }

  // 4. Expense changes
  const exp = expenseChanges(dataset);
  if (exp) {
    for (const c of exp.changes.filter((x) => x.significant).slice(0, 3)) {
      insights.push({
        id: `expense-${c.account.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
        title: `${c.account} rose ${formatSignedPercent(c.pctVsPrior)} in ${monthLabel(exp.month, "long")}`,
        severity: "watch",
        category: "expenses",
        facts: [
          { label: monthLabel(exp.month, "long"), value: formatCurrency(c.lastMonth) },
          { label: monthLabel(exp.priorMonth, "long"), value: formatCurrency(c.priorMonth) },
          { label: "Prior 3-month average", value: formatCurrency(c.baselineAverage) },
          { label: "Change vs prior month", value: formatCurrency(c.changeVsPrior) },
        ],
        forecasts: [],
        assumptions: [],
        trigger: "Expense account up at least 15% and $2,500 versus both the prior month and the prior 3-month average.",
        followUpQuestion: "What expenses have increased?",
      });
    }
  }

  // 5. Revenue trend (last 3 closed months vs prior 3) and gross margin
  const closed = closedPnlMonths(dataset);
  if (dataset.coverage.profitAndLoss && closed.length >= 6) {
    const recent = summarizePnl(closed.slice(-3));
    const prior = summarizePnl(closed.slice(-6, -3));
    const pct = pctChange(recent.revenue, prior.revenue);
    const range = `${monthLabel(closed[closed.length - 3].month)} - ${monthLabel(closed[closed.length - 1].month)}`;
    if (pct != null && Math.abs(pct) >= t.revenueTrendPct) {
      insights.push({
        id: "revenue-trend",
        title: `Revenue ${pct > 0 ? "up" : "down"} ${formatPercent(Math.abs(pct))} over the last three months`,
        severity: pct > 0 ? "positive" : "concern",
        category: "revenue",
        facts: [
          { label: `Revenue ${range}`, value: formatCurrency(recent.revenue) },
          { label: "Prior three months", value: formatCurrency(prior.revenue) },
        ],
        forecasts: [],
        assumptions: [],
        trigger: `Revenue for the last three closed months differs by at least ${formatPercent(t.revenueTrendPct, 0)} from the three months before.`,
        followUpQuestion: "How profitable were we last month?",
      });
    }
    if (closed.length >= 13) {
      const last = summarizePnl(closed.slice(-1));
      const lastYear = summarizePnl(closed.slice(-13, -12));
      const yoy = pctChange(last.revenue, lastYear.revenue);
      if (yoy != null && Math.abs(yoy) >= t.revenueTrendPct) {
        insights.push({
          id: "revenue-yoy",
          title: `${monthLabel(closed[closed.length - 1].month, "long")} revenue ${yoy > 0 ? "up" : "down"} ${formatPercent(Math.abs(yoy))} year over year`,
          severity: yoy > 0 ? "positive" : "watch",
          category: "revenue",
          facts: [
            { label: monthLabel(closed[closed.length - 1].month, "long"), value: formatCurrency(last.revenue) },
            { label: monthLabel(closed[closed.length - 13].month, "long"), value: formatCurrency(lastYear.revenue) },
          ],
          forecasts: [],
          assumptions: [],
          trigger: `Last closed month revenue differs by at least ${formatPercent(t.revenueTrendPct, 0)} from the same month a year earlier.`,
          followUpQuestion: "How profitable were we last month?",
        });
      }
    }
    const recent6 = summarizePnl(closed.slice(-6, -1));
    const lastMonth = summarizePnl(closed.slice(-1));
    if (recent6.grossMargin != null && lastMonth.grossMargin != null && recent6.grossMargin - lastMonth.grossMargin >= t.grossMarginDropPts) {
      insights.push({
        id: "gross-margin",
        title: `Gross margin fell to ${formatPercent(lastMonth.grossMargin)} in ${monthLabel(closed[closed.length - 1].month, "long")}`,
        severity: "watch",
        category: "profitability",
        facts: [
          { label: "Last closed month gross margin", value: formatPercent(lastMonth.grossMargin) },
          { label: "Prior five-month gross margin", value: formatPercent(recent6.grossMargin) },
        ],
        forecasts: [],
        assumptions: [],
        trigger: "Gross margin at least 2 percentage points below the prior five-month level.",
        followUpQuestion: "What expenses have increased?",
      });
    }
  }

  // 6. Working capital pressure: receivables growing faster than revenue
  if (dataset.coverage.balanceSheet && closed.length >= 6) {
    const nowBs = balanceSheetAt(dataset, dataset.asOfDate);
    const earlierMonth = closed[closed.length - 4];
    const earlierBs = earlierMonth ? balanceSheetAt(dataset, earlierMonth.endDate) : null;
    if (nowBs && earlierBs) {
      const arNow = summarizeBalanceSheet(nowBs).accountsReceivable;
      const arThen = summarizeBalanceSheet(earlierBs).accountsReceivable;
      const arGrowth = pctChange(arNow, arThen);
      const revGrowth = pctChange(summarizePnl(closed.slice(-3)).revenue, summarizePnl(closed.slice(-6, -3)).revenue);
      if (arGrowth != null && revGrowth != null && arGrowth - revGrowth >= t.workingCapitalGapPts) {
        insights.push({
          id: "working-capital",
          title: "Receivables are growing faster than revenue",
          severity: "watch",
          category: "working-capital",
          facts: [
            { label: `AR on ${formatIsoDate(earlierBs.date)}`, value: formatCurrency(arThen) },
            { label: `AR on ${formatIsoDate(nowBs.date)}`, value: formatCurrency(arNow) },
            { label: "AR growth", value: formatSignedPercent(arGrowth) },
            { label: "Revenue growth (3 months vs prior 3)", value: formatSignedPercent(revGrowth) },
          ],
          forecasts: [],
          assumptions: [],
          trigger: "Receivables growth exceeds revenue growth by at least 10 percentage points, which ties up cash.",
          followUpQuestion: "Which customers should we prioritize for collections?",
        });
      }
    }
  }

  // 7. Cash forecast shortfall
  const defaults = deriveForecastDefaults(dataset);
  const base = runForecast({ dataset, assumptions: defaults.assumptions, scenario: "base" });
  const conservative = runForecast({ dataset, assumptions: defaults.assumptions, scenario: "conservative" });
  if (base && conservative) {
    const min = defaults.assumptions.minimumCashBalance;
    const threshold = min ?? 0;
    const thresholdLabel = min != null ? `minimum cash balance of ${formatCurrency(min)}` : "zero";
    const baseBreach = base.weeks.find((w) => w.endingCash < threshold);
    const consBreach = conservative.weeks.find((w) => w.endingCash < threshold);
    if (baseBreach || consBreach) {
      const w = (baseBreach ?? consBreach)!;
      const which = baseBreach ? "base" : "conservative";
      insights.push({
        id: "cash-shortfall",
        title: `Projected cash falls below ${min != null ? "the minimum" : "zero"} in week ${w.week} (${which} case)`,
        severity: baseBreach ? "concern" : "watch",
        category: "cash",
        facts: [{ label: "Starting book cash", value: formatCurrency(base.startingCash) }],
        forecasts: [
          `Base case lowest projected cash: ${formatCurrency(base.lowestCash.amount)} in week ${base.lowestCash.week}.`,
          `Conservative case lowest projected cash: ${formatCurrency(conservative.lowestCash.amount)} in week ${conservative.lowestCash.week}.`,
          `Week ${w.week} ends ${formatIsoDate(w.endDate)} with projected cash of ${formatCurrency(w.endingCash)}.`,
        ],
        assumptions: [
          `Compared against a ${thresholdLabel}.`,
          "Uses the default 13-week forecast assumptions; adjust them on the Cash Flow page.",
        ],
        trigger: "Any week in the base or conservative 13-week forecast ends below the minimum cash balance (or zero if none is set).",
        followUpQuestion: "Are we going to run out of cash?",
      });
    } else {
      insights.push({
        id: "cash-outlook",
        title: "Projected cash stays above the minimum for 13 weeks",
        severity: "positive",
        category: "cash",
        facts: [{ label: "Starting book cash", value: formatCurrency(base.startingCash) }],
        forecasts: [
          `Base case lowest projected cash: ${formatCurrency(base.lowestCash.amount)} in week ${base.lowestCash.week}.`,
          `Conservative case lowest projected cash: ${formatCurrency(conservative.lowestCash.amount)} in week ${conservative.lowestCash.week}.`,
        ],
        assumptions: [`Compared against a ${thresholdLabel}.`, "Uses the default 13-week forecast assumptions."],
        trigger: "No week in the base or conservative forecast ends below the threshold.",
        followUpQuestion: "How much cash will we have in eight weeks?",
      });
    }
  }

  return insights.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}

/** Months between two "YYYY-MM" keys, exported for tests of trend windows. */
export function priorWindow(lastMonth: string, size: number): { start: string; end: string } {
  return { start: addMonths(lastMonth, -(2 * size - 1)), end: addMonths(lastMonth, -size) };
}

export function insightAsOfLabel(dataset: FinancialDataset): string {
  return `As of ${formatIsoDate(dataset.asOfDate, "long")}; trend comparisons use ${formatIsoDate(addDays(dataset.asOfDate, -30))} as the earlier date.`;
}
