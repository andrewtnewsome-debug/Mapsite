import { describe, expect, it } from "vitest";
import {
  applyScenario,
  deriveForecastDefaults,
  forecastDataWarnings,
  runAllScenarios,
  runForecast,
  SCENARIOS,
  weekIndexFor,
  type ForecastAssumptions,
} from "@/lib/finance/forecast";
import { buildDemoDataset } from "@/lib/demo/generate";
import { bill, emptyDataset, invoice, simpleBalanceSheet } from "./helpers/fixtures";

const AS_OF = "2026-06-15";

const zeroAssumptions: ForecastAssumptions = {
  collectionRate: 1,
  collectionDelayDays: 0,
  weeklyNewBillings: 0,
  newBillingsCollectionDays: 30,
  weeklyPayroll: 0,
  payrollFrequency: "weekly",
  weeklyRecurringExpenses: 0,
  vendorCostPctOfBillings: 0,
  vendorPaymentDays: 30,
  billPaymentDelayDays: 0,
  weeklyDebtService: 0,
  oneTimeItems: [],
  minimumCashBalance: null,
};

function dataset() {
  return emptyDataset({
    asOfDate: AS_OF,
    balanceSheets: [simpleBalanceSheet(AS_OF, { cash: 100_000, ar: 0, ap: 0, equity: 100_000 })],
    coverage: { ...emptyDataset().coverage, balanceSheet: true, invoices: true, bills: true },
  });
}

describe("week boundaries", () => {
  it("assigns dates to 7-day weeks starting the day after the as-of date", () => {
    expect(weekIndexFor(AS_OF, "2026-06-10")).toBe(1); // past dates fall in week 1
    expect(weekIndexFor(AS_OF, AS_OF)).toBe(1);
    expect(weekIndexFor(AS_OF, "2026-06-16")).toBe(1);
    expect(weekIndexFor(AS_OF, "2026-06-22")).toBe(1);
    expect(weekIndexFor(AS_OF, "2026-06-23")).toBe(2);
    expect(weekIndexFor(AS_OF, "2026-09-14")).toBe(13); // day 91
    expect(weekIndexFor(AS_OF, "2026-09-15")).toBe(14); // day 92, beyond horizon
  });
});

describe("13-week forecast engine", () => {
  it("collects open invoices on due date plus delay and pays bills on due date", () => {
    const d = dataset();
    d.invoices = [
      invoice({ id: "due-week-2", dueDate: "2026-06-20", txnDate: "2026-05-21", balance: 10_000 }), // +3 delay -> Jun 23 -> week 2
      invoice({ id: "overdue", dueDate: "2026-05-01", txnDate: "2026-04-01", balance: 5_000 }), // overdue 45d -> 31-60 bucket
      invoice({ id: "beyond", dueDate: "2026-12-01", txnDate: "2026-06-01", balance: 7_000 }),
    ];
    d.bills = [bill({ dueDate: "2026-06-29", balance: 4_000 }), bill({ dueDate: "2026-06-01", balance: 1_000 })];
    const r = runForecast({ dataset: d, assumptions: { ...zeroAssumptions, collectionDelayDays: 3 }, scenario: "base" })!;
    expect(r.startingCash).toBe(100_000);
    // overdue invoice expected 3 days from as-of (week 1) at 95% collectability for the 31-60 bucket
    expect(r.weeks[0].collectionsOpenAr).toBe(4_750);
    expect(r.weeks[1].collectionsOpenAr).toBe(10_000);
    expect(r.openArBeyondHorizon).toBe(7_000);
    expect(r.openArNotExpected).toBe(250);
    // overdue bill paid in week 1, Jun 29 bill in week 2
    expect(r.weeks[0].vendorPaymentsOpenBills).toBe(1_000);
    expect(r.weeks[1].vendorPaymentsOpenBills).toBe(4_000);
    expect(r.weeks[0].endingCash).toBe(103_750);
    expect(r.weeks[1].endingCash).toBe(109_750);
    expect(r.endingCash).toBe(109_750);
  });

  it("rolls cash forward week to week (ending = beginning + inflows - outflows)", () => {
    const d = dataset();
    const r = runForecast({
      dataset: d,
      assumptions: { ...zeroAssumptions, weeklyPayroll: 20_000, weeklyRecurringExpenses: 5_000, weeklyNewBillings: 30_000, newBillingsCollectionDays: 14, weeklyDebtService: 1_000 },
      scenario: "base",
    })!;
    for (const w of r.weeks) {
      expect(w.endingCash).toBeCloseTo(w.beginningCash + w.totalInflows - w.totalOutflows, 2);
    }
    for (let i = 1; i < r.weeks.length; i++) expect(r.weeks[i].beginningCash).toBe(r.weeks[i - 1].endingCash);
    // new billings collected 2 weeks after billing: weeks 1-2 have none, week 3 onwards 30,000
    expect(r.weeks[0].collectionsNewBillings).toBe(0);
    expect(r.weeks[1].collectionsNewBillings).toBe(0);
    expect(r.weeks[2].collectionsNewBillings).toBe(30_000);
    expect(r.totals.payroll).toBe(260_000);
    // 100k - 13*26k + 11*30k = 100k - 338k + 330k
    expect(r.endingCash).toBe(92_000);
    expect(r.lowestCash.week).toBe(2);
    expect(r.lowestCash.amount).toBe(48_000);
  });

  it("supports bi-weekly payroll", () => {
    const r = runForecast({ dataset: dataset(), assumptions: { ...zeroAssumptions, weeklyPayroll: 10_000, payrollFrequency: "biweekly" }, scenario: "base" })!;
    expect(r.weeks[0].payroll).toBe(20_000);
    expect(r.weeks[1].payroll).toBe(0);
    expect(r.totals.payroll).toBe(140_000); // 7 pay periods in 13 weeks
  });

  it("applies one-time inflows and outflows in the right week and ignores invalid ones", () => {
    const r = runForecast({
      dataset: dataset(),
      assumptions: {
        ...zeroAssumptions,
        oneTimeItems: [
          { id: "1", label: "Equipment sale", week: 4, amount: 25_000, direction: "inflow" },
          { id: "2", label: "Tax payment", week: 6, amount: 40_000, direction: "outflow" },
          { id: "3", label: "Bad week", week: 20, amount: 1, direction: "outflow" },
          { id: "4", label: "Negative", week: 2, amount: -5, direction: "outflow" },
        ],
      },
      scenario: "base",
    })!;
    expect(r.weeks[3].oneTimeInflows).toBe(25_000);
    expect(r.weeks[5].oneTimeOutflows).toBe(40_000);
    expect(r.weeks[1].oneTimeOutflows).toBe(0);
    expect(r.endingCash).toBe(85_000);
  });

  it("flags weeks below the minimum cash balance and below zero", () => {
    const r = runForecast({ dataset: dataset(), assumptions: { ...zeroAssumptions, weeklyPayroll: 15_000, minimumCashBalance: 50_000 }, scenario: "base" })!;
    expect(r.weeksBelowMinimum[0]).toBe(4); // 100k - 4*15k = 40k
    expect(r.weeksBelowZero[0]).toBe(7); // 100k - 7*15k = -5k
  });

  it("returns null without a starting cash balance instead of inventing one", () => {
    const d = emptyDataset();
    expect(runForecast({ dataset: d, assumptions: zeroAssumptions, scenario: "base" })).toBeNull();
    expect(forecastDataWarnings(d).some((w) => w.level === "critical")).toBe(true);
  });
});

describe("scenarios", () => {
  const base: ForecastAssumptions = { ...zeroAssumptions, collectionRate: 0.95, collectionDelayDays: 10, weeklyNewBillings: 100_000, weeklyRecurringExpenses: 10_000, vendorCostPctOfBillings: 0.2 };

  it("adjusts assumptions per scenario definition", () => {
    const c = applyScenario(base, SCENARIOS.conservative);
    expect(c.collectionRate).toBeCloseTo(0.85);
    expect(c.collectionDelayDays).toBe(24);
    expect(c.weeklyNewBillings).toBe(85_000);
    expect(c.weeklyRecurringExpenses).toBe(10_500);
    const o = applyScenario(base, SCENARIOS.optimistic);
    expect(o.collectionRate).toBeCloseTo(0.98);
    expect(o.collectionDelayDays).toBe(5);
    expect(applyScenario({ ...base, collectionRate: 0.99, collectionDelayDays: 2 }, SCENARIOS.optimistic).collectionRate).toBe(1);
    expect(applyScenario({ ...base, collectionDelayDays: 2 }, SCENARIOS.optimistic).collectionDelayDays).toBe(0);
    expect(applyScenario(base, SCENARIOS.base)).toEqual(base);
  });

  it("orders ending cash conservative < base < optimistic on the demo company", () => {
    const demo = buildDemoDataset("2026-11-18", { generatedAt: "t" });
    const defaults = deriveForecastDefaults(demo);
    const all = runAllScenarios(demo, defaults.assumptions)!;
    expect(all.conservative.endingCash).toBeLessThan(all.base.endingCash);
    expect(all.base.endingCash).toBeLessThan(all.optimistic.endingCash);
  });
});

describe("forecast defaults", () => {
  it("derives defaults from the demo data with explanations for every assumption", () => {
    const demo = buildDemoDataset("2026-11-18", { generatedAt: "t" });
    const { assumptions, sources, warnings } = deriveForecastDefaults(demo);
    expect(assumptions.weeklyPayroll).toBe(demo.managementAssumptions!.weeklyPayroll);
    expect(assumptions.weeklyNewBillings).toBeGreaterThan(100_000);
    expect(assumptions.weeklyRecurringExpenses).toBeGreaterThan(0);
    expect(assumptions.vendorCostPctOfBillings).toBeGreaterThan(0.1);
    expect(assumptions.vendorCostPctOfBillings).toBeLessThan(0.3);
    expect(assumptions.weeklyDebtService).toBeGreaterThan(0);
    expect(assumptions.minimumCashBalance).toBe(300_000);
    for (const field of ["weeklyPayroll", "weeklyRecurringExpenses", "collectionDelayDays", "weeklyNewBillings"]) {
      expect(sources.find((s) => s.field === field)?.explanation.length).toBeGreaterThan(10);
    }
    expect(warnings.join(" ")).toContain("distributions");
  });

  it("falls back to zero with warnings when there is no history", () => {
    const d = emptyDataset({ balanceSheets: [simpleBalanceSheet("2026-06-15", { cash: 1, ar: 0, ap: 0, equity: 1 })] });
    const { assumptions, warnings } = deriveForecastDefaults(d);
    expect(assumptions.weeklyPayroll).toBe(0);
    expect(assumptions.weeklyNewBillings).toBe(0);
    expect(warnings.some((w) => w.includes("No closed months"))).toBe(true);
    expect(warnings.some((w) => w.includes("payroll"))).toBe(true);
  });
});
