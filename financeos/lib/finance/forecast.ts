/**
 * 13-week cash flow forecast (receipts and disbursements method).
 *
 * Starting point: the book cash balance on the as-of date (a recorded fact).
 * Everything after that is a projection built from:
 *   - open invoices, collected after their due date plus a delay (from data + assumptions)
 *   - expected new billings, collected after a lag (assumption)
 *   - open vendor bills, paid on their due date plus a delay (from data + assumptions)
 *   - payroll, recurring operating expenses, vendor costs tied to new work and
 *     debt service (assumptions, with defaults derived from history)
 *   - one-time inflows and outflows entered by the user
 *
 * Accounting profit is never used as cash. Depreciation and other non-cash
 * expenses are excluded from the default expense run-rate.
 */

import type { FinancialDataset } from "@/lib/domain/types";
import { addDays, daysBetween } from "@/lib/domain/dates";
import { roundCents, safeDivide, sum } from "@/lib/domain/money";
import { openBillsAsOf, openInvoicesAsOf, type AgingBucket } from "./aging";
import { cashPosition } from "./metrics";
import { ratioContext } from "./ratios";
import { trailingClosedMonths } from "./statements";

export const FORECAST_WEEKS = 13;

export type ScenarioId = "base" | "conservative" | "optimistic";

export interface OneTimeItem {
  id: string;
  label: string;
  /** Week number, 1-13. */
  week: number;
  /** Positive amount. */
  amount: number;
  direction: "inflow" | "outflow";
}

export interface ForecastAssumptions {
  /** Share of open receivables expected to be collected, 0-1. */
  collectionRate: number;
  /** Days after the due date that customers typically pay. */
  collectionDelayDays: number;
  /** Expected new invoicing per week. */
  weeklyNewBillings: number;
  /** Days from invoicing to collection for new invoices. */
  newBillingsCollectionDays: number;
  weeklyPayroll: number;
  payrollFrequency: "weekly" | "biweekly";
  /** Non-payroll operating costs paid directly (rent, insurance, fuel, software...). */
  weeklyRecurringExpenses: number;
  /** Future vendor bills for new work, as a share of new billings, 0-1. */
  vendorCostPctOfBillings: number;
  /** Days from new billing to paying the related vendor bills. */
  vendorPaymentDays: number;
  /** Days after due date that open vendor bills are paid. */
  billPaymentDelayDays: number;
  /** Loan principal and interest per week. */
  weeklyDebtService: number;
  oneTimeItems: OneTimeItem[];
  minimumCashBalance: number | null;
}

export interface ScenarioDefinition {
  id: ScenarioId;
  label: string;
  description: string;
  collectionRateDelta: number;
  collectionDelayDeltaDays: number;
  billingsMultiplier: number;
  expenseMultiplier: number;
  /** Collectability by aging bucket, applied on top of the collection rate. */
  collectability: Record<AgingBucket, number>;
}

export const SCENARIOS: Record<ScenarioId, ScenarioDefinition> = {
  base: {
    id: "base",
    label: "Base",
    description: "Your assumptions as entered.",
    collectionRateDelta: 0,
    collectionDelayDeltaDays: 0,
    billingsMultiplier: 1,
    expenseMultiplier: 1,
    collectability: { current: 1, "1-30": 1, "31-60": 0.95, "61-90": 0.85, "90+": 0.5 },
  },
  conservative: {
    id: "conservative",
    label: "Conservative",
    description: "Collection rate 10 points lower, customers pay 14 days later, new billings 15% lower, non-payroll costs 5% higher.",
    collectionRateDelta: -0.1,
    collectionDelayDeltaDays: 14,
    billingsMultiplier: 0.85,
    expenseMultiplier: 1.05,
    collectability: { current: 1, "1-30": 0.95, "31-60": 0.85, "61-90": 0.7, "90+": 0.25 },
  },
  optimistic: {
    id: "optimistic",
    label: "Optimistic",
    description: "Collection rate 3 points higher (max 100%), customers pay 5 days sooner, new billings 8% higher, non-payroll costs 2% lower.",
    collectionRateDelta: 0.03,
    collectionDelayDeltaDays: -5,
    billingsMultiplier: 1.08,
    expenseMultiplier: 0.98,
    collectability: { current: 1, "1-30": 1, "31-60": 1, "61-90": 0.95, "90+": 0.7 },
  },
};

export interface AssumptionSource {
  field: keyof Omit<ForecastAssumptions, "oneTimeItems">;
  explanation: string;
  /** Whether the default came from accounting data, management input, or a fixed fallback. */
  basis: "accounting-data" | "management-input" | "fallback";
}

export interface ForecastDefaults {
  assumptions: ForecastAssumptions;
  sources: AssumptionSource[];
  warnings: string[];
}

const PAYROLL_PATTERN = /payroll|wage|salar|labor|labour|benefit|compensation|officer/i;
const NON_CASH_PATTERN = /depreciation|amortization|amortisation|bad debt|unrealized/i;
const DEBT_PATTERN = /loan|note|debt|principal|line of credit|mortgage/i;

/** Average days customers paid after the due date, weighted by amount (last 180 days of payments). */
export function historicalPaymentDelay(dataset: FinancialDataset): number | null {
  if (!dataset.coverage.payments || !dataset.coverage.invoices) return null;
  const since = addDays(dataset.asOfDate, -180);
  const invoiceById = new Map(dataset.invoices.map((i) => [i.id, i]));
  let weighted = 0;
  let total = 0;
  for (const p of dataset.payments) {
    if (p.txnDate < since || p.txnDate > dataset.asOfDate) continue;
    for (const a of p.applied) {
      const inv = invoiceById.get(a.invoiceId);
      if (!inv || a.amount <= 0) continue;
      weighted += Math.max(0, daysBetween(inv.dueDate ?? inv.txnDate, p.txnDate)) * a.amount;
      total += a.amount;
    }
  }
  return total > 0 ? Math.round(weighted / total) : null;
}

/** Average days from invoice date to payment, weighted by amount (last 180 days). */
export function historicalDaysToCollect(dataset: FinancialDataset): number | null {
  if (!dataset.coverage.payments || !dataset.coverage.invoices) return null;
  const since = addDays(dataset.asOfDate, -180);
  const invoiceById = new Map(dataset.invoices.map((i) => [i.id, i]));
  let weighted = 0;
  let total = 0;
  for (const p of dataset.payments) {
    if (p.txnDate < since || p.txnDate > dataset.asOfDate) continue;
    for (const a of p.applied) {
      const inv = invoiceById.get(a.invoiceId);
      if (!inv || a.amount <= 0) continue;
      weighted += Math.max(0, daysBetween(inv.txnDate, p.txnDate)) * a.amount;
      total += a.amount;
    }
  }
  return total > 0 ? Math.round(weighted / total) : null;
}

export function deriveForecastDefaults(dataset: FinancialDataset): ForecastDefaults {
  const sources: AssumptionSource[] = [];
  const warnings: string[] = [];
  const t3 = trailingClosedMonths(dataset, 3);
  const hasPnl = dataset.coverage.profitAndLoss && t3.length > 0;
  const monthsUsed = t3.length;
  const perMonth = (total: number) => (monthsUsed > 0 ? total / monthsUsed : 0);
  const toWeekly = (monthly: number) => roundCents((monthly * 12) / 52);
  const lines = t3.flatMap((m) => m.lines);
  const revenueMonthly = perMonth(sum(lines.filter((l) => l.category === "income").map((l) => l.amount)));
  const costLines = lines.filter((l) => l.category === "cogs" || l.category === "expense" || l.category === "otherExpense");
  const payrollMonthly = perMonth(sum(costLines.filter((l) => PAYROLL_PATTERN.test(l.account)).map((l) => l.amount)));
  const nonCashMonthly = perMonth(sum(costLines.filter((l) => NON_CASH_PATTERN.test(l.account)).map((l) => l.amount)));
  const totalCostsMonthly = perMonth(sum(costLines.map((l) => l.amount)));

  if (!hasPnl) warnings.push("No closed months of profit and loss data are available, so expense and billing assumptions use zero. Enter them manually.");
  else if (monthsUsed < 3) warnings.push(`Only ${monthsUsed} closed month(s) of profit and loss data are available; run-rate assumptions may be unreliable.`);

  // Vendor bills entered in the trailing months (to split bill-funded costs from directly paid ones).
  let billsMonthly: number | null = null;
  if (dataset.coverage.bills && monthsUsed > 0) {
    const first = `${t3[0].month}-01`;
    const last = t3[t3.length - 1].endDate;
    billsMonthly = perMonth(sum(dataset.bills.filter((b) => b.txnDate >= first && b.txnDate <= last).map((b) => b.totalAmount)));
  }

  // Payroll.
  let weeklyPayroll = 0;
  const mgmtPayroll = dataset.managementAssumptions?.weeklyPayroll ?? null;
  if (mgmtPayroll != null) {
    weeklyPayroll = mgmtPayroll;
    sources.push({ field: "weeklyPayroll", basis: "management-input", explanation: dataset.managementAssumptions!.weeklyPayrollSource });
  } else if (hasPnl && payrollMonthly > 0) {
    weeklyPayroll = toWeekly(payrollMonthly);
    sources.push({
      field: "weeklyPayroll",
      basis: "accounting-data",
      explanation: `Average monthly payroll-related expense accounts (names containing payroll, wages, salaries, labor or benefits) over the last ${monthsUsed} closed month(s), converted to weekly.`,
    });
    warnings.push("Payroll is estimated from expense account names, not a payroll register. Confirm the weekly payroll amount.");
  } else {
    sources.push({ field: "weeklyPayroll", basis: "fallback", explanation: "No payroll accounts found. Enter your weekly payroll." });
    warnings.push("No payroll expense accounts were found. Weekly payroll is set to $0 until you enter it.");
  }

  // Bill-funded vendor costs tied to new work.
  const vendorPct = billsMonthly != null && revenueMonthly > 0 ? Math.min(0.9, billsMonthly / revenueMonthly) : 0;
  sources.push({
    field: "vendorCostPctOfBillings",
    basis: billsMonthly != null ? "accounting-data" : "fallback",
    explanation:
      billsMonthly != null
        ? `Vendor bills entered over the last ${monthsUsed} closed month(s) as a share of revenue in the same months.`
        : "Vendor bill history is not available, so new vendor costs are set to 0%.",
  });

  // Directly paid recurring costs = total costs - payroll - non-cash - bill-funded costs.
  const recurringMonthly = Math.max(0, totalCostsMonthly - payrollMonthly - nonCashMonthly - (billsMonthly ?? 0));
  sources.push({
    field: "weeklyRecurringExpenses",
    basis: hasPnl ? "accounting-data" : "fallback",
    explanation: hasPnl
      ? `Average monthly total costs over the last ${monthsUsed} closed month(s), less payroll, non-cash items (depreciation, amortization) and costs billed by vendors, converted to weekly.`
      : "No expense history available.",
  });

  // Collections timing.
  const delay = historicalPaymentDelay(dataset);
  sources.push({
    field: "collectionDelayDays",
    basis: delay != null ? "accounting-data" : "fallback",
    explanation:
      delay != null
        ? "Average days customers paid after the due date over the last 180 days, weighted by amount."
        : "Payment history is not available; assumes customers pay 7 days after the due date.",
  });
  const daysToCollect = historicalDaysToCollect(dataset);
  const ctx = ratioContext(dataset);
  const dso = ctx.bs && ctx.trailing3 && ctx.trailing3Days ? safeDivide(ctx.bs.accountsReceivable, safeDivide(ctx.trailing3.revenue, ctx.trailing3Days)) : null;
  const newCollectionDays = daysToCollect ?? (dso != null ? Math.round(dso) : 45);
  sources.push({
    field: "newBillingsCollectionDays",
    basis: daysToCollect != null || dso != null ? "accounting-data" : "fallback",
    explanation:
      daysToCollect != null
        ? "Average days from invoice date to payment over the last 180 days, weighted by amount."
        : dso != null
          ? "Days sales outstanding (DSO) from the latest balance sheet."
          : "No collection history; assumes 45 days.",
  });
  sources.push({
    field: "weeklyNewBillings",
    basis: hasPnl ? "accounting-data" : "fallback",
    explanation: hasPnl ? `Average monthly revenue over the last ${monthsUsed} closed month(s), converted to weekly.` : "No revenue history available.",
  });
  sources.push({ field: "collectionRate", basis: "fallback", explanation: "Assumes 97% of open receivables are collectible before aging adjustments. Adjust for known disputes." });
  sources.push({ field: "vendorPaymentDays", basis: "fallback", explanation: "Assumes vendor bills for new work are paid about 30 days after the related billing." });
  sources.push({ field: "billPaymentDelayDays", basis: "fallback", explanation: "Assumes open vendor bills are paid on their due date; overdue bills are paid in week 1." });

  // Debt service from the cash flow statement financing lines.
  let weeklyDebtService = 0;
  if (dataset.coverage.cashFlow) {
    const cf = dataset.monthlyCashFlow.filter((m) => !m.isPartial).slice(-3);
    const debtOut = sum(cf.flatMap((m) => m.lines.filter((l) => l.section === "financing" && DEBT_PATTERN.test(l.label) && l.amount < 0).map((l) => -l.amount)));
    const interestMonthly = perMonth(sum(costLines.filter((l) => /interest/i.test(l.account)).map((l) => l.amount)));
    if (cf.length > 0 && debtOut > 0) {
      weeklyDebtService = toWeekly(debtOut / cf.length + interestMonthly);
      sources.push({ field: "weeklyDebtService", basis: "accounting-data", explanation: "Average monthly loan principal repayments (cash flow statement) plus interest expense, converted to weekly." });
    }
  }
  if (weeklyDebtService === 0) {
    sources.push({ field: "weeklyDebtService", basis: "fallback", explanation: "No loan repayments found in recent cash flow statements." });
  }
  // Interest is in the expense run-rate; avoid double counting when debt service includes it.
  const interestMonthly = perMonth(sum(costLines.filter((l) => /interest/i.test(l.account)).map((l) => l.amount)));
  const recurringExInterest = weeklyDebtService > 0 ? Math.max(0, recurringMonthly - interestMonthly) : recurringMonthly;

  warnings.push("Owner distributions, tax payments, capital purchases and new borrowing are not included unless you add them as one-time items.");

  return {
    assumptions: {
      collectionRate: 0.97,
      collectionDelayDays: delay ?? 7,
      weeklyNewBillings: hasPnl ? toWeekly(revenueMonthly) : 0,
      newBillingsCollectionDays: newCollectionDays,
      weeklyPayroll,
      payrollFrequency: "weekly",
      weeklyRecurringExpenses: toWeekly(recurringExInterest),
      vendorCostPctOfBillings: Math.round(vendorPct * 1000) / 1000,
      vendorPaymentDays: 30,
      billPaymentDelayDays: 0,
      weeklyDebtService,
      oneTimeItems: [],
      minimumCashBalance: dataset.managementAssumptions?.minimumCashBalance ?? null,
    },
    sources,
    warnings,
  };
}

/* ------------------------------------------------------------------ engine */

export interface ForecastWeek {
  week: number;
  startDate: string;
  endDate: string;
  beginningCash: number;
  collectionsOpenAr: number;
  collectionsNewBillings: number;
  oneTimeInflows: number;
  totalInflows: number;
  vendorPaymentsOpenBills: number;
  vendorPaymentsNewWork: number;
  payroll: number;
  recurringExpenses: number;
  debtService: number;
  oneTimeOutflows: number;
  totalOutflows: number;
  netCashFlow: number;
  endingCash: number;
}

export interface ForecastWarning {
  level: "info" | "warning" | "critical";
  message: string;
}

export interface ForecastResult {
  scenario: ScenarioDefinition;
  asOfDate: string;
  startingCash: number;
  weeks: ForecastWeek[];
  endingCash: number;
  lowestCash: { week: number; amount: number };
  weeksBelowMinimum: number[];
  weeksBelowZero: number[];
  totals: { inflows: number; outflows: number; collectionsOpenAr: number; collectionsNewBillings: number; payroll: number };
  /** Open AR expected after week 13. */
  openArBeyondHorizon: number;
  /** Open AR not expected to be collected under this scenario's collectability. */
  openArNotExpected: number;
  openBillsBeyondHorizon: number;
  effectiveAssumptions: ForecastAssumptions;
}

/** Week number (1-based) in which a date falls; dates on or before the as-of date fall in week 1. */
export function weekIndexFor(asOfDate: string, date: string): number {
  const days = daysBetween(asOfDate, date);
  if (days <= 0) return 1;
  return Math.ceil(days / 7);
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

export function applyScenario(base: ForecastAssumptions, scenario: ScenarioDefinition): ForecastAssumptions {
  return {
    ...base,
    collectionRate: clamp(base.collectionRate + scenario.collectionRateDelta, 0, 1),
    collectionDelayDays: Math.max(0, base.collectionDelayDays + scenario.collectionDelayDeltaDays),
    newBillingsCollectionDays: Math.max(0, base.newBillingsCollectionDays + scenario.collectionDelayDeltaDays),
    weeklyNewBillings: roundCents(base.weeklyNewBillings * scenario.billingsMultiplier),
    weeklyRecurringExpenses: roundCents(base.weeklyRecurringExpenses * scenario.expenseMultiplier),
    vendorCostPctOfBillings: clamp(base.vendorCostPctOfBillings * scenario.expenseMultiplier, 0, 1),
  };
}

export interface ForecastInput {
  dataset: FinancialDataset;
  assumptions: ForecastAssumptions;
  scenario: ScenarioId;
  /** Override for tests; defaults to the dataset cash position. */
  startingCash?: number;
}

export function runForecast({ dataset, assumptions, scenario, startingCash }: ForecastInput): ForecastResult | null {
  const cash = startingCash ?? cashPosition(dataset)?.amount ?? null;
  if (cash == null) return null;
  const def = SCENARIOS[scenario];
  const a = applyScenario(assumptions, def);
  const asOf = dataset.asOfDate;
  const weeks: ForecastWeek[] = Array.from({ length: FORECAST_WEEKS }, (_, i) => ({
    week: i + 1,
    startDate: addDays(asOf, i * 7 + 1),
    endDate: addDays(asOf, (i + 1) * 7),
    beginningCash: 0,
    collectionsOpenAr: 0,
    collectionsNewBillings: 0,
    oneTimeInflows: 0,
    totalInflows: 0,
    vendorPaymentsOpenBills: 0,
    vendorPaymentsNewWork: 0,
    payroll: 0,
    recurringExpenses: 0,
    debtService: 0,
    oneTimeOutflows: 0,
    totalOutflows: 0,
    netCashFlow: 0,
    endingCash: 0,
  }));

  // Open receivables.
  let openArBeyondHorizon = 0;
  let openArNotExpected = 0;
  if (dataset.coverage.invoices) {
    for (const inv of openInvoicesAsOf(dataset.invoices, asOf)) {
      const expectedShare = a.collectionRate * def.collectability[inv.bucket];
      const expected = roundCents(inv.balance * expectedShare);
      openArNotExpected = roundCents(openArNotExpected + inv.balance - expected);
      const target = addDays(inv.effectiveDueDate, a.collectionDelayDays);
      const date = target > asOf ? target : addDays(asOf, Math.max(1, a.collectionDelayDays));
      const w = weekIndexFor(asOf, date);
      if (w > FORECAST_WEEKS) openArBeyondHorizon = roundCents(openArBeyondHorizon + expected);
      else weeks[w - 1].collectionsOpenAr = roundCents(weeks[w - 1].collectionsOpenAr + expected);
    }
  }

  // Open payables.
  let openBillsBeyondHorizon = 0;
  if (dataset.coverage.bills) {
    for (const bill of openBillsAsOf(dataset.bills, asOf)) {
      const date = addDays(bill.effectiveDueDate, a.billPaymentDelayDays);
      const w = weekIndexFor(asOf, date);
      if (w > FORECAST_WEEKS) openBillsBeyondHorizon = roundCents(openBillsBeyondHorizon + bill.balance);
      else weeks[w - 1].vendorPaymentsOpenBills = roundCents(weeks[w - 1].vendorPaymentsOpenBills + bill.balance);
    }
  }

  // New billings collected after the lag; related vendor costs paid after their lag.
  const collectLagWeeks = Math.ceil(a.newBillingsCollectionDays / 7);
  const vendorLagWeeks = Math.ceil(a.vendorPaymentDays / 7);
  for (let billingWeek = 1; billingWeek <= FORECAST_WEEKS; billingWeek++) {
    const cw = billingWeek + collectLagWeeks;
    if (cw <= FORECAST_WEEKS) {
      weeks[cw - 1].collectionsNewBillings = roundCents(weeks[cw - 1].collectionsNewBillings + a.weeklyNewBillings * a.collectionRate);
    }
    const vw = billingWeek + vendorLagWeeks;
    if (vw <= FORECAST_WEEKS) {
      weeks[vw - 1].vendorPaymentsNewWork = roundCents(weeks[vw - 1].vendorPaymentsNewWork + a.weeklyNewBillings * a.vendorCostPctOfBillings);
    }
  }

  for (const w of weeks) {
    if (a.payrollFrequency === "weekly") w.payroll = roundCents(a.weeklyPayroll);
    else w.payroll = w.week % 2 === 1 ? roundCents(a.weeklyPayroll * 2) : 0;
    w.recurringExpenses = roundCents(a.weeklyRecurringExpenses);
    w.debtService = roundCents(a.weeklyDebtService);
  }

  for (const item of a.oneTimeItems) {
    if (!(item.week >= 1 && item.week <= FORECAST_WEEKS) || !(item.amount > 0)) continue;
    const w = weeks[Math.floor(item.week) - 1];
    if (item.direction === "inflow") w.oneTimeInflows = roundCents(w.oneTimeInflows + item.amount);
    else w.oneTimeOutflows = roundCents(w.oneTimeOutflows + item.amount);
  }

  let running = roundCents(cash);
  for (const w of weeks) {
    w.beginningCash = running;
    w.totalInflows = roundCents(w.collectionsOpenAr + w.collectionsNewBillings + w.oneTimeInflows);
    w.totalOutflows = roundCents(w.vendorPaymentsOpenBills + w.vendorPaymentsNewWork + w.payroll + w.recurringExpenses + w.debtService + w.oneTimeOutflows);
    w.netCashFlow = roundCents(w.totalInflows - w.totalOutflows);
    running = roundCents(running + w.netCashFlow);
    w.endingCash = running;
  }

  const lowest = weeks.reduce((min, w) => (w.endingCash < min.amount ? { week: w.week, amount: w.endingCash } : min), {
    week: weeks[0].week,
    amount: weeks[0].endingCash,
  });
  const min = a.minimumCashBalance;
  return {
    scenario: def,
    asOfDate: asOf,
    startingCash: roundCents(cash),
    weeks,
    endingCash: running,
    lowestCash: lowest,
    weeksBelowMinimum: min == null ? [] : weeks.filter((w) => w.endingCash < min).map((w) => w.week),
    weeksBelowZero: weeks.filter((w) => w.endingCash < 0).map((w) => w.week),
    totals: {
      inflows: sum(weeks.map((w) => w.totalInflows)),
      outflows: sum(weeks.map((w) => w.totalOutflows)),
      collectionsOpenAr: sum(weeks.map((w) => w.collectionsOpenAr)),
      collectionsNewBillings: sum(weeks.map((w) => w.collectionsNewBillings)),
      payroll: sum(weeks.map((w) => w.payroll)),
    },
    openArBeyondHorizon,
    openArNotExpected,
    openBillsBeyondHorizon,
    effectiveAssumptions: a,
  };
}

/** Data-sufficiency checks shown above the forecast. */
export function forecastDataWarnings(dataset: FinancialDataset): ForecastWarning[] {
  const out: ForecastWarning[] = [];
  if (!cashPosition(dataset)) out.push({ level: "critical", message: "No cash balance is available, so a forecast cannot be produced." });
  if (!dataset.coverage.invoices) out.push({ level: "warning", message: "Invoice data is not available; expected collections from open receivables are excluded." });
  if (!dataset.coverage.bills) out.push({ level: "warning", message: "Vendor bill data is not available; payments on open bills are excluded." });
  if (!dataset.coverage.payments) out.push({ level: "info", message: "Customer payment history is not available; collection timing uses fallback assumptions." });
  const missingDue = dataset.invoices.filter((i) => i.balance > 0 && !i.dueDate).length;
  if (missingDue > 0) out.push({ level: "info", message: `${missingDue} open invoice(s) have no due date; their invoice date is used instead.` });
  const closed = dataset.monthlyPnl.filter((m) => !m.isPartial).length;
  if (dataset.coverage.profitAndLoss && closed < 3) out.push({ level: "warning", message: `Only ${closed} closed month(s) of history; run-rate assumptions may be unreliable.` });
  return out;
}

export function runAllScenarios(dataset: FinancialDataset, assumptions: ForecastAssumptions): Record<ScenarioId, ForecastResult> | null {
  const base = runForecast({ dataset, assumptions, scenario: "base" });
  if (!base) return null;
  return {
    base,
    conservative: runForecast({ dataset, assumptions, scenario: "conservative" })!,
    optimistic: runForecast({ dataset, assumptions, scenario: "optimistic" })!,
  };
}
