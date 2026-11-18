/**
 * Financial data access layer for the AI CFO.
 *
 * Every tool runs deterministic TypeScript calculations over the canonical
 * dataset and returns verified facts with their source, reporting date and
 * assumptions. The language model only ever sees these results; it never
 * computes or looks up numbers itself.
 */

import { z } from "zod";
import type { FinancialDataset } from "@/lib/domain/types";
import { DATA_SOURCE_LABELS } from "@/lib/domain/types";
import { addDays, addMonths, formatIsoDate, monthLabel, monthOf } from "@/lib/domain/dates";
import { pctChange, safeDivide, sum } from "@/lib/domain/money";
import { AGING_BUCKETS, openBillsAsOf } from "@/lib/finance/aging";
import { deriveForecastDefaults, runAllScenarios, type ForecastAssumptions } from "@/lib/finance/forecast";
import { generateInsights } from "@/lib/finance/insights";
import {
  cashPosition,
  EXPENSE_CHANGE_THRESHOLD,
  expenseChanges,
  healthIndicators,
  lastClosedMonthComparison,
  overdueTrend,
  payablesSnapshot,
  receivablesSnapshot,
} from "@/lib/finance/metrics";
import { periodContaining } from "@/lib/finance/periods";
import { computeRatios, findRatio } from "@/lib/finance/ratios";
import { closedPnlMonths, summarizePnl } from "@/lib/finance/statements";
import { formatCurrency, formatPercent, formatRatio, formatSignedPercent } from "@/lib/format";

export type FactKind = "currency" | "percent" | "count" | "days" | "months" | "ratio" | "date" | "text";
/** fact = recorded/calculated from accounting data; forecast = projection math; assumption = an input that was assumed. */
export type FactBasis = "fact" | "forecast" | "assumption";

export interface Fact {
  label: string;
  value: number | string | null;
  display: string;
  kind: FactKind;
  basis: FactBasis;
}

export interface ToolTable {
  columns: string[];
  rows: string[][];
}

export interface ToolResult {
  toolId: ToolId;
  title: string;
  asOfDate: string;
  source: string;
  facts: Fact[];
  table?: ToolTable;
  assumptions: string[];
  notes: string[];
  /** Deterministic plain-English answer used when the local model is unavailable. */
  summary: string;
  available: boolean;
}

export const TOOL_IDS = [
  "cash_position",
  "receivables_summary",
  "top_customers_owed",
  "ar_over_days",
  "customer_balance",
  "collections_priorities",
  "profit_and_loss",
  "expense_changes",
  "revenue_trend",
  "cash_forecast",
  "payables_summary",
  "financial_ratios",
  "financial_risks",
  "weekly_briefing",
] as const;

export type ToolId = (typeof TOOL_IDS)[number];

export const ToolParamsSchema = z
  .object({
    limit: z.number().int().min(1).max(25).optional(),
    days: z.number().int().min(1).max(365).optional(),
    weeks: z.number().int().min(1).max(13).optional(),
    customer: z.string().max(100).optional(),
    period: z.string().max(40).optional(),
    overdueOnly: z.boolean().optional(),
  })
  .strict();

export type ToolParams = z.infer<typeof ToolParamsSchema>;

/** Extra context tools may use, e.g. the owner's saved forecast assumptions. */
export interface ToolContext {
  savedForecast?: { savedAt: string; assumptions: ForecastAssumptions } | null;
}

export interface ToolCall {
  id: ToolId;
  params: ToolParams;
}

export const TOOL_DESCRIPTIONS: Record<ToolId, string> = {
  cash_position: "Current book cash balance by bank account and months of expenses it covers.",
  receivables_summary: "Total accounts receivable, overdue amount, aging buckets, percent of invoices overdue, DSO.",
  top_customers_owed: "Customers ranked by how much they owe (params: limit, overdueOnly).",
  ar_over_days: "Receivables more than N days past due (params: days).",
  customer_balance: "Balance, overdue amount and open invoices for one named customer (params: customer).",
  collections_priorities: "Customers to prioritize for collections, ranked by a deterministic score (params: limit).",
  profit_and_loss: "Revenue, gross profit, expenses, net income and margins for a period (params: period = last-month | YYYY-MM | ytd | ttm | last-quarter).",
  expense_changes: "Which expense accounts increased or decreased in the last closed month.",
  revenue_trend: "Monthly revenue trend, recent change and year-over-year comparison.",
  cash_forecast: "Projected cash balance in N weeks from the 13-week forecast under three scenarios (params: weeks).",
  payables_summary: "Accounts payable total, overdue bills and bills coming due.",
  financial_ratios: "Liquidity, margin, efficiency and leverage ratios.",
  financial_risks: "Biggest financial risks: rule-based alerts and health indicators.",
  weekly_briefing: "A weekly CFO briefing combining cash, receivables, profitability, forecast and risks.",
};

const NA = "Not available";

function fact(label: string, value: number | string | null, kind: FactKind, basis: FactBasis = "fact"): Fact {
  let display: string;
  if (value == null) display = NA;
  else if (typeof value === "string") display = value;
  else
    switch (kind) {
      case "currency":
        display = formatCurrency(value, { cents: Math.abs(value) < 1000 && value % 1 !== 0 });
        break;
      case "percent":
        display = formatPercent(value);
        break;
      case "days":
        display = `${Math.round(value)} days`;
        break;
      case "months":
        display = `${value.toFixed(1)} months`;
        break;
      case "ratio":
        display = `${value.toFixed(2)}x`;
        break;
      default:
        display = value.toLocaleString("en-US");
    }
  return { label, value, display, kind, basis };
}

function base(ds: FinancialDataset, toolId: ToolId, title: string): Omit<ToolResult, "facts" | "summary"> {
  return {
    toolId,
    title,
    asOfDate: ds.asOfDate,
    source: `${DATA_SOURCE_LABELS[ds.source]}${ds.source === "demo" ? " (fictional demonstration data)" : ""}`,
    assumptions: [],
    notes: [],
    available: true,
  };
}

function unavailable(ds: FinancialDataset, toolId: ToolId, title: string, reason: string): ToolResult {
  return { ...base(ds, toolId, title), facts: [], summary: `${title}: not available. ${reason}`, notes: [reason], available: false };
}

/* ------------------------------------------------------------------ period parsing */

export interface ResolvedPeriod {
  label: string;
  months: string[];
  comparisonLabel: string | null;
  comparisonMonths: string[];
}

/** Resolve a period parameter against the closed months in the dataset. */
export function resolvePeriod(ds: FinancialDataset, period: string | undefined): ResolvedPeriod | null {
  const closed = closedPnlMonths(ds).map((m) => m.month);
  if (closed.length === 0) return null;
  const last = closed[closed.length - 1];
  const p = (period ?? "last-month").toLowerCase();
  const range = (start: string, end: string) => closed.filter((m) => m >= start && m <= end);
  if (p === "ttm") {
    const months = closed.slice(-12);
    const prior = closed.slice(-24, -12);
    return { label: `the trailing ${months.length} months (${monthLabel(months[0])} to ${monthLabel(last)})`, months, comparisonLabel: prior.length ? "the prior 12 months" : null, comparisonMonths: prior };
  }
  if (p === "ytd") {
    const fyStart = periodContaining(ds.asOfDate.slice(0, 7), "year", ds.company.fiscalYearStartMonth).startMonth;
    const months = ds.monthlyPnl.filter((m) => m.month >= fyStart).map((m) => m.month);
    const prior = months.map((m) => addMonths(m, -12)).filter((m) => closed.includes(m));
    return { label: `year to date (${monthLabel(fyStart)} through ${formatIsoDate(ds.asOfDate)})`, months, comparisonLabel: prior.length ? "the same months last year" : null, comparisonMonths: prior };
  }
  if (p === "last-quarter" || p === "this-quarter") {
    const ref = p === "this-quarter" ? ds.asOfDate.slice(0, 7) : last;
    let q = periodContaining(ref, "quarter", ds.company.fiscalYearStartMonth);
    if (p === "last-quarter" && q.endMonth > last) q = periodContaining(addMonths(q.startMonth, -1), "quarter", ds.company.fiscalYearStartMonth);
    const prev = periodContaining(addMonths(q.startMonth, -1), "quarter", ds.company.fiscalYearStartMonth);
    const allMonths = ds.monthlyPnl.map((m) => m.month);
    return {
      label: q.label,
      months: allMonths.filter((m) => m >= q.startMonth && m <= q.endMonth),
      comparisonLabel: prev.label,
      comparisonMonths: range(prev.startMonth, prev.endMonth),
    };
  }
  const monthMatch = /^(\d{4}-\d{2})$/.exec(p);
  const month = monthMatch ? monthMatch[1] : last;
  const available = ds.monthlyPnl.map((m) => m.month);
  if (!available.includes(month)) return null;
  const prior = addMonths(month, -1);
  return { label: monthLabel(month, "long"), months: [month], comparisonLabel: closed.includes(prior) ? monthLabel(prior, "long") : null, comparisonMonths: closed.includes(prior) ? [prior] : [] };
}

/* ------------------------------------------------------------------ tools */

function cashTool(ds: FinancialDataset): ToolResult {
  const cash = cashPosition(ds);
  if (!cash) return unavailable(ds, "cash_position", "Cash position", "No bank account balances are available from this data source.");
  const coverage = findRatio(computeRatios(ds), "cash-coverage")?.value ?? null;
  const facts = [fact("Total book cash balance", cash.amount, "currency"), ...cash.accounts.map((a) => fact(`${a.name} balance`, a.balance, "currency"))];
  if (coverage != null) facts.push(fact("Months of average expenses covered by cash", coverage, "months"));
  return {
    ...base(ds, "cash_position", "Cash position"),
    facts,
    notes: [cash.caveat],
    summary: `As of ${formatIsoDate(cash.asOfDate)}, the book cash balance is ${formatCurrency(cash.amount)} across ${cash.accounts.length} bank account${cash.accounts.length === 1 ? "" : "s"}${coverage != null ? `, enough to cover about ${coverage.toFixed(1)} months of average expenses` : ""}. ${cash.caveat}`,
  };
}

function receivablesTool(ds: FinancialDataset): ToolResult {
  const ar = receivablesSnapshot(ds);
  if (!ar) return unavailable(ds, "receivables_summary", "Accounts receivable", "Invoice data is not available.");
  const a = ar.aging;
  const dso = findRatio(computeRatios(ds), "dso")?.value ?? null;
  const trend = overdueTrend(ds, [30, 0]);
  const facts = [
    fact("Total accounts receivable", a.total, "currency"),
    fact("Open invoices", a.openInvoiceCount, "count"),
    fact("Overdue balance", a.overdueAmount, "currency"),
    fact("Overdue share of receivables (by amount)", a.overdueShareOfBalance, "percent"),
    fact("Overdue invoices", a.overdueCount, "count"),
    fact("Share of open invoices that are overdue (by count)", a.overdueShareOfInvoices, "percent"),
    ...AGING_BUCKETS.map((b) => fact(`${b.label}`, a.buckets[b.key].amount, "currency")),
    fact("Partially paid invoices", a.partiallyPaidCount, "count"),
    fact("Days sales outstanding", dso, "days"),
  ];
  if (trend) facts.push(fact(`Overdue balance 30 days earlier (${formatIsoDate(trend[0].date)})`, trend[0].overdue, "currency"));
  return {
    ...base(ds, "receivables_summary", "Accounts receivable summary"),
    facts,
    summary: `Customers owe ${formatCurrency(a.total)} across ${a.openInvoiceCount} open invoices. ${formatCurrency(a.overdueAmount)} (${formatPercent(a.overdueShareOfBalance)}) is past due, and ${a.overdueCount} of ${a.openInvoiceCount} invoices (${formatPercent(a.overdueShareOfInvoices)}) are overdue. ${formatCurrency(a.over60Amount)} is more than 60 days overdue.`,
  };
}

function topCustomersTool(ds: FinancialDataset, p: ToolParams): ToolResult {
  const ar = receivablesSnapshot(ds);
  if (!ar) return unavailable(ds, "top_customers_owed", "Customers who owe the most", "Invoice data is not available.");
  const limit = p.limit ?? 5;
  const list = [...ar.customers].sort((x, y) => (p.overdueOnly ? y.overdue - x.overdue : y.total - x.total)).filter((c) => !p.overdueOnly || c.overdue > 0).slice(0, limit);
  const title = p.overdueOnly ? `Top ${limit} customers by overdue balance` : `Top ${limit} customers by amount owed`;
  return {
    ...base(ds, "top_customers_owed", title),
    facts: list.flatMap((c, i) => [
      fact(`#${i + 1} ${c.customerName}: total owed`, c.total, "currency"),
      fact(`#${i + 1} ${c.customerName}: overdue`, c.overdue, "currency"),
      fact(`#${i + 1} ${c.customerName}: share of total AR`, c.shareOfTotal, "percent"),
    ]),
    table: {
      columns: ["Rank", "Customer", "Total owed", "Overdue", "Oldest days past due", "Share of AR"],
      rows: list.map((c, i) => [String(i + 1), c.customerName, formatCurrency(c.total), formatCurrency(c.overdue), String(c.oldestDaysOverdue), formatPercent(c.shareOfTotal)]),
    },
    summary: list.length
      ? `${title} as of ${formatIsoDate(ds.asOfDate)}:\n${list.map((c, i) => `${i + 1}. **${c.customerName}**: ${formatCurrency(p.overdueOnly ? c.overdue : c.total)}${p.overdueOnly ? " overdue" : ` owed, ${formatCurrency(c.overdue)} overdue`}`).join("\n")}\n\nTogether they account for ${formatPercent(safeDivide(sum(list.map((c) => c.total)), ar.aging.total))} of receivables.`
      : "No customers currently have an open balance.",
  };
}

function arOverDaysTool(ds: FinancialDataset, p: ToolParams): ToolResult {
  const ar = receivablesSnapshot(ds);
  const days = p.days ?? 60;
  if (!ar) return unavailable(ds, "ar_over_days", `Receivables over ${days} days`, "Invoice data is not available.");
  const old = ar.open.filter((i) => i.daysOverdue > days);
  const amount = sum(old.map((i) => i.balance));
  const share = safeDivide(amount, ar.aging.total);
  return {
    ...base(ds, "ar_over_days", `Receivables more than ${days} days overdue`),
    facts: [
      fact(`Balance more than ${days} days past due`, amount, "currency"),
      fact(`Share of total receivables more than ${days} days past due`, share, "percent"),
      fact(`Invoices more than ${days} days past due`, old.length, "count"),
      fact("Total accounts receivable", ar.aging.total, "currency"),
    ],
    table: {
      columns: ["Invoice", "Customer", "Days past due", "Balance"],
      rows: old.slice(0, 10).map((i) => [`#${i.docNumber ?? i.id}`, i.customerName, String(i.daysOverdue), formatCurrency(i.balance, { cents: true })]),
    },
    assumptions: ["Days are counted past each invoice's due date (not the invoice date)."],
    summary: `${formatCurrency(amount)} (${formatPercent(share)} of receivables) is more than ${days} days past due, across ${old.length} invoice${old.length === 1 ? "" : "s"}${old.length ? `: ${old.slice(0, 4).map((i) => `${i.customerName} #${i.docNumber ?? i.id} ${formatCurrency(i.balance)} at ${i.daysOverdue} days`).join("; ")}` : ""}.`,
  };
}

/** Case-insensitive fuzzy match of a customer name mentioned in a question. */
export function matchCustomer(ds: FinancialDataset, text: string): { id: string; name: string } | null {
  const q = text.toLowerCase().replace(/[^a-z0-9& ]/g, " ");
  const stop = new Set(["the", "inc", "llc", "co", "group", "and", "of", "company", "services", "corp", "ltd"]);
  let best: { id: string; name: string; score: number } | null = null;
  for (const c of ds.customers) {
    const name = c.name.toLowerCase();
    if (q.includes(name.replace(/[^a-z0-9& ]/g, " ").trim())) return { id: c.id, name: c.name };
    const words = name.split(/[^a-z0-9&]+/).filter((w) => w.length > 2 && !stop.has(w));
    const hits = words.filter((w) => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(q)).length;
    const score = words.length ? hits / words.length : 0;
    if (hits > 0 && score >= 0.5 && (!best || score > best.score)) best = { id: c.id, name: c.name, score };
  }
  return best ? { id: best.id, name: best.name } : null;
}

function customerTool(ds: FinancialDataset, p: ToolParams): ToolResult {
  const ar = receivablesSnapshot(ds);
  if (!ar) return unavailable(ds, "customer_balance", "Customer balance", "Invoice data is not available.");
  const m = p.customer ? matchCustomer(ds, p.customer) : null;
  if (!m) return unavailable(ds, "customer_balance", "Customer balance", `No customer matching "${p.customer ?? ""}" was found.`);
  const c = ar.customers.find((x) => x.customerId === m.id);
  const invoices = ar.open.filter((i) => i.customerId === m.id);
  if (!c) {
    return { ...base(ds, "customer_balance", `${m.name} balance`), facts: [fact(`${m.name} open balance`, 0, "currency")], summary: `${m.name} has no open invoices as of ${formatIsoDate(ds.asOfDate)}.` };
  }
  return {
    ...base(ds, "customer_balance", `${m.name} balance`),
    facts: [
      fact(`${m.name} total owed`, c.total, "currency"),
      fact(`${m.name} overdue`, c.overdue, "currency"),
      fact(`${m.name} open invoices`, c.openInvoiceCount, "count"),
      fact(`${m.name} oldest invoice days past due`, c.oldestDaysOverdue, "days"),
      fact(`${m.name} share of total AR`, c.shareOfTotal, "percent"),
    ],
    table: {
      columns: ["Invoice", "Invoice date", "Due date", "Days past due", "Balance", "Status"],
      rows: invoices.map((i) => [`#${i.docNumber ?? i.id}`, formatIsoDate(i.txnDate), formatIsoDate(i.dueDate), i.daysOverdue > 0 ? String(i.daysOverdue) : "Current", formatCurrency(i.balance, { cents: true }), i.status === "partially-paid" ? "Partially paid" : "Unpaid"]),
    },
    summary: `${m.name} owes ${formatCurrency(c.total)} across ${c.openInvoiceCount} open invoice${c.openInvoiceCount === 1 ? "" : "s"}; ${formatCurrency(c.overdue)} is overdue and the oldest invoice is ${c.oldestDaysOverdue} days past due. That is ${formatPercent(c.shareOfTotal)} of total receivables.`,
  };
}

function prioritiesTool(ds: FinancialDataset, p: ToolParams): ToolResult {
  const ar = receivablesSnapshot(ds);
  if (!ar) return unavailable(ds, "collections_priorities", "Collections priorities", "Invoice data is not available.");
  const list = ar.priorities.slice(0, p.limit ?? 5);
  return {
    ...base(ds, "collections_priorities", "Collections priorities"),
    facts: list.flatMap((c, i) => [fact(`#${i + 1} ${c.customerName}: overdue`, c.overdue, "currency"), fact(`#${i + 1} ${c.customerName}: priority score (0-100)`, c.score, "count"), fact(`#${i + 1} ${c.customerName}: oldest days past due`, c.oldestDaysOverdue, "days")]),
    table: { columns: ["Rank", "Customer", "Overdue", "Priority", "Why"], rows: list.map((c, i) => [String(i + 1), c.customerName, formatCurrency(c.overdue), `${c.level} (${c.score})`, c.reasons.join("; ")]) },
    assumptions: ["Priority score: 40 points for overdue balance relative to the largest, 35 for balance-weighted days past due (capped at 90), 25 for the share over 60 days. High is 60+, medium 35+."],
    summary: list.length
      ? `Customers to prioritize for collections:\n${list.map((c, i) => `${i + 1}. **${c.customerName}**: ${formatCurrency(c.overdue)} overdue, ${c.level} priority (${c.reasons.join(", ")})`).join("\n")}`
      : "No customers have overdue balances.",
  };
}

function pnlTool(ds: FinancialDataset, p: ToolParams): ToolResult {
  if (!ds.coverage.profitAndLoss) return unavailable(ds, "profit_and_loss", "Profit and loss", "Profit and loss data is not available.");
  const r = resolvePeriod(ds, p.period);
  if (!r) return unavailable(ds, "profit_and_loss", "Profit and loss", `No profit and loss data for ${p.period ?? "that period"}.`);
  const cur = summarizePnl(ds.monthlyPnl.filter((m) => r.months.includes(m.month)));
  const cmp = r.comparisonMonths.length ? summarizePnl(ds.monthlyPnl.filter((m) => r.comparisonMonths.includes(m.month))) : null;
  const facts = [
    fact(`Revenue, ${r.label}`, cur.revenue, "currency"),
    fact(`Cost of goods sold, ${r.label}`, cur.cogs, "currency"),
    fact(`Gross profit, ${r.label}`, cur.grossProfit, "currency"),
    fact(`Gross margin, ${r.label}`, cur.grossMargin, "percent"),
    fact(`Operating expenses, ${r.label}`, cur.operatingExpenses, "currency"),
    fact(`Operating income, ${r.label}`, cur.operatingIncome, "currency"),
    fact(`Net income, ${r.label}`, cur.netIncome, "currency"),
    fact(`Net margin, ${r.label}`, cur.netMargin, "percent"),
  ];
  if (cmp && r.comparisonLabel) {
    facts.push(fact(`Revenue, ${r.comparisonLabel}`, cmp.revenue, "currency"), fact(`Net income, ${r.comparisonLabel}`, cmp.netIncome, "currency"), fact("Revenue change", pctChange(cur.revenue, cmp.revenue), "percent"), fact("Net income change", pctChange(cur.netIncome, cmp.netIncome), "percent"));
  }
  const notes = cur.includesPartialMonth ? ["Includes the current month to date, which is incomplete."] : [];
  return {
    ...base(ds, "profit_and_loss", `Profit and loss, ${r.label}`),
    facts,
    notes: [...notes, "Net income is accounting profit on an accrual basis, not cash."],
    summary: `For ${r.label}, revenue was ${formatCurrency(cur.revenue)} and net income was ${formatCurrency(cur.netIncome)} (net margin ${formatPercent(cur.netMargin)}, gross margin ${formatPercent(cur.grossMargin)}).${cmp && r.comparisonLabel ? ` Compared with ${r.comparisonLabel}, revenue changed ${formatSignedPercent(pctChange(cur.revenue, cmp.revenue))} and net income changed ${formatSignedPercent(pctChange(cur.netIncome, cmp.netIncome))} (from ${formatCurrency(cmp.netIncome)}).` : ""}${notes.length ? ` ${notes[0]}` : ""}`,
  };
}

function expenseTool(ds: FinancialDataset): ToolResult {
  const e = expenseChanges(ds);
  if (!e) return unavailable(ds, "expense_changes", "Expense changes", "At least two closed months of profit and loss data are needed.");
  const increases = e.changes.filter((c) => c.changeVsPrior > 0).slice(0, 5);
  const significant = e.changes.filter((c) => c.significant);
  const totalPrior = sum(e.changes.map((c) => c.priorMonth));
  const totalLast = sum(e.changes.map((c) => c.lastMonth));
  return {
    ...base(ds, "expense_changes", `Expense changes, ${monthLabel(e.month, "long")} vs ${monthLabel(e.priorMonth, "long")}`),
    facts: [
      fact(`Total expenses ${monthLabel(e.month, "long")}`, totalLast, "currency"),
      fact(`Total expenses ${monthLabel(e.priorMonth, "long")}`, totalPrior, "currency"),
      ...increases.flatMap((c) => [fact(`${c.account} ${monthLabel(e.month, "long")}`, c.lastMonth, "currency"), fact(`${c.account} ${monthLabel(e.priorMonth, "long")}`, c.priorMonth, "currency"), fact(`${c.account} change`, c.changeVsPrior, "currency"), fact(`${c.account} change %`, c.pctVsPrior, "percent")]),
    ],
    table: { columns: ["Account", monthLabel(e.month), monthLabel(e.priorMonth), "Change", "Flagged"], rows: e.changes.slice(0, 8).map((c) => [c.account, formatCurrency(c.lastMonth), formatCurrency(c.priorMonth), `${formatCurrency(c.changeVsPrior)} (${formatSignedPercent(c.pctVsPrior)})`, c.significant ? "Yes" : ""]) },
    assumptions: [`"Significant" means up at least ${formatPercent(EXPENSE_CHANGE_THRESHOLD.pct, 0)} and ${formatCurrency(EXPENSE_CHANGE_THRESHOLD.amount)} versus both the prior month and the prior three-month average.`],
    notes: ["The accounting data shows how much each expense changed, not why. Causes must be confirmed from the underlying transactions."],
    summary: `${monthLabel(e.month, "long")} expenses totaled ${formatCurrency(totalLast)} vs ${formatCurrency(totalPrior)} in ${monthLabel(e.priorMonth, "long")}. ${significant.length ? `Significant increases: ${significant.map((c) => `${c.account} up ${formatCurrency(c.changeVsPrior)} (${formatSignedPercent(c.pctVsPrior)})`).join("; ")}.` : "No account met the significant-increase threshold."} Largest increases: ${increases.map((c) => `${c.account} ${formatSignedPercent(c.pctVsPrior)}`).join(", ") || "none"}.`,
  };
}

function revenueTrendTool(ds: FinancialDataset): ToolResult {
  const closed = closedPnlMonths(ds);
  if (!ds.coverage.profitAndLoss || closed.length === 0) return unavailable(ds, "revenue_trend", "Revenue trend", "Profit and loss data is not available.");
  const last6 = closed.slice(-6).map((m) => ({ month: m.month, revenue: summarizePnl([m]).revenue }));
  const recent3 = closed.length >= 6 ? summarizePnl(closed.slice(-3)).revenue : null;
  const prior3 = closed.length >= 6 ? summarizePnl(closed.slice(-6, -3)).revenue : null;
  const lastMonth = closed[closed.length - 1];
  const yearAgo = closed.find((m) => m.month === addMonths(lastMonth.month, -12));
  const yoy = yearAgo ? pctChange(summarizePnl([lastMonth]).revenue, summarizePnl([yearAgo]).revenue) : null;
  return {
    ...base(ds, "revenue_trend", "Revenue trend"),
    facts: [
      ...last6.map((m) => fact(`Revenue ${monthLabel(m.month, "long")}`, m.revenue, "currency")),
      fact("Last 3 closed months revenue", recent3, "currency"),
      fact("Prior 3 months revenue", prior3, "currency"),
      fact("3-month change", pctChange(recent3, prior3), "percent"),
      fact(`Year-over-year change for ${monthLabel(lastMonth.month, "long")}`, yoy, "percent"),
    ],
    summary: `Revenue for the last six closed months: ${last6.map((m) => `${monthLabel(m.month)} ${formatCurrency(m.revenue)}`).join(", ")}. The last three months were ${formatSignedPercent(pctChange(recent3, prior3))} versus the three before${yoy != null ? `, and ${monthLabel(lastMonth.month, "long")} was ${formatSignedPercent(yoy)} year over year` : ""}.`,
  };
}

function forecastTool(ds: FinancialDataset, p: ToolParams, ctx: ToolContext = {}): ToolResult {
  const weeks = Math.min(13, Math.max(1, p.weeks ?? 13));
  const defaults = deriveForecastDefaults(ds);
  const saved = ctx.savedForecast ?? null;
  const a = saved?.assumptions ?? defaults.assumptions;
  const all = runAllScenarios(ds, a);
  if (!all) return unavailable(ds, "cash_forecast", "Cash forecast", "No starting cash balance is available.");
  const at = (id: "base" | "conservative" | "optimistic") => all[id].weeks[weeks - 1];
  const min = a.minimumCashBalance;
  const source = saved ? `Your saved forecast assumptions (saved ${formatIsoDate(saved.savedAt.slice(0, 10))})` : "Default forecast assumptions derived from the data";
  return {
    ...base(ds, "cash_forecast", `Projected cash in ${weeks} week${weeks === 1 ? "" : "s"}`),
    facts: [
      fact("Starting book cash", all.base.startingCash, "currency"),
      fact(`Week ${weeks} end date`, formatIsoDate(at("base").endDate), "date", "forecast"),
      fact(`Base case projected cash at week ${weeks}`, at("base").endingCash, "currency", "forecast"),
      fact(`Conservative case projected cash at week ${weeks}`, at("conservative").endingCash, "currency", "forecast"),
      fact(`Optimistic case projected cash at week ${weeks}`, at("optimistic").endingCash, "currency", "forecast"),
      fact("Base case lowest projected cash (13 weeks)", all.base.lowestCash.amount, "currency", "forecast"),
      fact("Base case lowest week", all.base.lowestCash.week, "count", "forecast"),
      fact("Conservative case lowest projected cash (13 weeks)", all.conservative.lowestCash.amount, "currency", "forecast"),
      fact("Conservative case lowest week", all.conservative.lowestCash.week, "count", "forecast"),
      fact("Minimum cash balance", min, "currency", "assumption"),
      fact("Weekly payroll assumption", a.weeklyPayroll, "currency", "assumption"),
      fact("Weekly new billings assumption", a.weeklyNewBillings, "currency", "assumption"),
      fact("Collection rate assumption", a.collectionRate, "percent", "assumption"),
      fact("Collection delay assumption", a.collectionDelayDays, "days", "assumption"),
    ],
    assumptions: [
      `${source}: payroll ${formatCurrency(a.weeklyPayroll)}/week, recurring expenses ${formatCurrency(a.weeklyRecurringExpenses)}/week, new billings ${formatCurrency(a.weeklyNewBillings)}/week collected after ${a.newBillingsCollectionDays} days, collection rate ${formatPercent(a.collectionRate, 0)}.`,
      "Conservative: 10 points lower collection rate, 14 days slower collections, 15% lower billings. Optimistic: 3 points higher, 5 days faster, 8% higher billings.",
      ...(a.oneTimeItems.length ? [`Includes ${a.oneTimeItems.length} one-time item(s) entered on the Cash Flow page.`] : []),
      ...defaults.warnings,
    ],
    notes: ["These are projections from stated assumptions, not facts. They match the 13-week forecast on the Cash Flow page."],
    summary: `Starting from book cash of ${formatCurrency(all.base.startingCash)}, the forecast projects ${formatCurrency(at("base").endingCash)} at the end of week ${weeks} (${formatIsoDate(at("base").endDate)}) in the base case, ${formatCurrency(at("conservative").endingCash)} in the conservative case and ${formatCurrency(at("optimistic").endingCash)} in the optimistic case. The base case low point is ${formatCurrency(all.base.lowestCash.amount)} in week ${all.base.lowestCash.week}${min != null ? `; the conservative case ${all.conservative.weeksBelowMinimum.length ? `falls below the ${formatCurrency(min)} minimum in ${all.conservative.weeksBelowMinimum.length} week(s)` : `stays above the ${formatCurrency(min)} minimum`}` : ""}. This is a projection based on assumptions.`,
  };
}

function payablesTool(ds: FinancialDataset): ToolResult {
  const ap = payablesSnapshot(ds);
  if (!ap) return unavailable(ds, "payables_summary", "Accounts payable", "Vendor bill data is not available.");
  const byVendor = new Map<string, number>();
  for (const b of openBillsAsOf(ds.bills, ds.asOfDate)) byVendor.set(b.vendorName, (byVendor.get(b.vendorName) ?? 0) + b.balance);
  const top = [...byVendor.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  return {
    ...base(ds, "payables_summary", "Accounts payable"),
    facts: [
      fact("Total accounts payable", ap.total, "currency"),
      fact("Overdue bills", ap.overdue, "currency"),
      fact("Overdue bill count", ap.overdueCount, "count"),
      fact("Bills due in the next 7 days", ap.dueNext7Days, "currency"),
      fact("Bills due in the next 30 days", ap.dueNext30Days, "currency"),
      ...top.map(([v, amt]) => fact(`${v} open balance`, Math.round(amt * 100) / 100, "currency")),
    ],
    summary: `Accounts payable is ${formatCurrency(ap.total)} across ${ap.billCount} open bills; ${formatCurrency(ap.overdue)} is overdue and ${formatCurrency(ap.dueNext30Days)} is due in the next 30 days.`,
  };
}

function ratiosTool(ds: FinancialDataset): ToolResult {
  const ratios = computeRatios(ds);
  return {
    ...base(ds, "financial_ratios", "Financial ratios"),
    facts: ratios.map((r) => fact(r.name, r.value, r.format === "percent" ? "percent" : r.format === "days" ? "days" : r.format === "currency" ? "currency" : r.format === "months" ? "months" : "ratio")),
    assumptions: ratios.map((r) => `${r.name} = ${r.formula}`),
    summary: ratios.map((r) => `${r.name}: ${formatRatio(r.value, r.format)}`).join("; ") + ".",
  };
}

function risksTool(ds: FinancialDataset, ctx: ToolContext = {}): ToolResult {
  const insights = generateInsights(ds, { forecastAssumptions: ctx.savedForecast?.assumptions ?? null }).filter((i) => i.severity === "concern" || i.severity === "watch");
  const health = healthIndicators(ds);
  return {
    ...base(ds, "financial_risks", "Financial risks"),
    facts: [
      ...insights.flatMap((i) => [fact(`Alert (${i.severity})`, i.title, "text"), ...i.facts.slice(0, 3).map((f) => fact(f.label, f.value, "text")), ...i.forecasts.slice(0, 2).map((f) => fact("Forecast", f, "text", "forecast"))]),
      ...health.map((h) => fact(`${h.name} health (${h.status})`, h.summary, "text")),
    ],
    assumptions: insights.map((i) => `Rule for "${i.title}": ${i.trigger}`),
    notes: ["Risks are identified by fixed thresholds on the data. Causes are not known from the accounting records alone."],
    summary: insights.length ? `Risks flagged by FinanceOS rules: ${insights.map((i) => `${i.title} (${i.severity})`).join("; ")}.` : "No risk thresholds are currently triggered.",
  };
}

function briefingTool(ds: FinancialDataset, ctx: ToolContext = {}): ToolResult {
  const parts = [cashTool(ds), receivablesTool(ds), prioritiesTool(ds, { limit: 3 }), pnlTool(ds, { period: "last-month" }), forecastTool(ds, { weeks: 4 }, ctx), risksTool(ds, ctx), payablesTool(ds)];
  const month = lastClosedMonthComparison(ds);
  const trend = overdueTrend(ds, [7, 0]);
  const weekChange = trend ? trend[1].overdue - trend[0].overdue : null;
  const facts = parts.filter((p) => p.available).flatMap((p) => p.facts.slice(0, p.toolId === "financial_risks" ? 12 : 8));
  if (weekChange != null && trend) facts.push(fact(`Change in overdue receivables since ${formatIsoDate(trend[0].date)}`, weekChange, "currency"));
  return {
    ...base(ds, "weekly_briefing", `Weekly CFO briefing for the week of ${formatIsoDate(addDays(ds.asOfDate, 0))}`),
    facts,
    assumptions: parts.flatMap((p) => p.assumptions).slice(0, 6),
    notes: parts.flatMap((p) => p.notes).slice(0, 4),
    summary: [
      `Weekly briefing (${formatIsoDate(ds.asOfDate, "long")}).`,
      ...parts.filter((p) => p.available).map((p) => p.summary),
      month ? `Last closed month: ${month.label}.` : "",
      weekChange != null ? `Overdue receivables changed by ${formatCurrency(weekChange)} over the past 7 days.` : "",
    ]
      .filter(Boolean)
      .join("\n\n"),
  };
}

export function runTool(ds: FinancialDataset, call: ToolCall, ctx: ToolContext = {}): ToolResult {
  const p = ToolParamsSchema.parse(call.params ?? {});
  switch (call.id) {
    case "cash_position":
      return cashTool(ds);
    case "receivables_summary":
      return receivablesTool(ds);
    case "top_customers_owed":
      return topCustomersTool(ds, p);
    case "ar_over_days":
      return arOverDaysTool(ds, p);
    case "customer_balance":
      return customerTool(ds, p);
    case "collections_priorities":
      return prioritiesTool(ds, p);
    case "profit_and_loss":
      return pnlTool(ds, p);
    case "expense_changes":
      return expenseTool(ds);
    case "revenue_trend":
      return revenueTrendTool(ds);
    case "cash_forecast":
      return forecastTool(ds, p, ctx);
    case "payables_summary":
      return payablesTool(ds);
    case "financial_ratios":
      return ratiosTool(ds);
    case "financial_risks":
      return risksTool(ds, ctx);
    case "weekly_briefing":
      return briefingTool(ds, ctx);
  }
}

/** Month key for a month name in a question, resolved to the most recent such month on or before the as-of date. */
export function monthFromName(monthNumber: number, asOfDate: string): string {
  let m = `${asOfDate.slice(0, 4)}-${String(monthNumber).padStart(2, "0")}`;
  if (m > monthOf(asOfDate)) m = addMonths(m, -12);
  return m;
}
