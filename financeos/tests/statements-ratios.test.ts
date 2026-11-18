import { describe, expect, it } from "vitest";
import { computeRatios, findRatio } from "@/lib/finance/ratios";
import { summarizeBalanceSheet, summarizePnl, pnlForPeriod } from "@/lib/finance/statements";
import { availablePeriods, parsePeriodKey, periodContaining, previousPeriod, samePeriodPriorYear } from "@/lib/finance/periods";
import { cashPosition, expenseChanges, healthIndicators, lastClosedMonthComparison } from "@/lib/finance/metrics";
import { emptyDataset, pnlMonth, simpleBalanceSheet } from "./helpers/fixtures";

describe("P&L aggregation", () => {
  it("computes gross profit, operating income, net income and margins", () => {
    const s = summarizePnl([
      pnlMonth("2026-04", 100_000, { "COGS:Labor": 40_000, Rent: 10_000, "Other:Interest": 1_000 }),
      pnlMonth("2026-05", 120_000, { "COGS:Labor": 50_000, Rent: 10_000, "Other:Interest": 1_000 }),
    ]);
    expect(s.revenue).toBe(220_000);
    expect(s.cogs).toBe(90_000);
    expect(s.grossProfit).toBe(130_000);
    expect(s.operatingExpenses).toBe(20_000);
    expect(s.operatingIncome).toBe(110_000);
    expect(s.netIncome).toBe(108_000);
    expect(s.totalExpenses).toBe(112_000);
    expect(s.grossMargin).toBeCloseTo(130 / 220);
    expect(s.netMargin).toBeCloseTo(108 / 220);
    expect(s.lines.find((l) => l.account === "Labor")?.amount).toBe(90_000);
  });

  it("returns null margins for zero revenue rather than dividing by zero", () => {
    const s = summarizePnl([pnlMonth("2026-04", 0, { Rent: 1_000 })]);
    expect(s.netIncome).toBe(-1_000);
    expect(s.grossMargin).toBeNull();
    expect(s.netMargin).toBeNull();
  });

  it("reports missing months for a period and null for a period with no data", () => {
    const d = emptyDataset({ monthlyPnl: [pnlMonth("2026-04", 10, {}), pnlMonth("2026-05", 10, {})], coverage: { ...emptyDataset().coverage, profitAndLoss: true } });
    const q2 = pnlForPeriod(d, periodContaining("2026-05", "quarter"))!;
    expect(q2.revenue).toBe(20);
    expect(q2.missingMonths).toEqual(["2026-06"]);
    expect(pnlForPeriod(d, periodContaining("2025-01", "month"))).toBeNull();
  });
});

describe("periods", () => {
  it("builds calendar and fiscal quarters", () => {
    expect(periodContaining("2026-05", "quarter")).toMatchObject({ label: "Q2 2026", startMonth: "2026-04", endMonth: "2026-06" });
    // Fiscal year starting July: May 2026 is Q4 of FY2026
    expect(periodContaining("2026-05", "quarter", 7)).toMatchObject({ label: "Q4 FY2026", startMonth: "2026-04", endMonth: "2026-06" });
    expect(periodContaining("2026-08", "year", 7)).toMatchObject({ label: "Fiscal FY2027", startMonth: "2026-07", endMonth: "2027-06" });
    expect(periodContaining("2026-08", "year")).toMatchObject({ startMonth: "2026-01", endMonth: "2026-12" });
  });

  it("finds prior and prior-year periods across year boundaries", () => {
    expect(previousPeriod(periodContaining("2026-01", "month")).startMonth).toBe("2025-12");
    expect(previousPeriod(periodContaining("2026-02", "quarter")).label).toBe("Q4 2025");
    expect(samePeriodPriorYear(periodContaining("2026-02", "quarter")).label).toBe("Q1 2025");
  });

  it("round-trips period keys and rejects invalid keys", () => {
    for (const p of [periodContaining("2026-05", "month"), periodContaining("2026-05", "quarter", 7), periodContaining("2026-05", "year", 4)]) {
      expect(parsePeriodKey(p.key)).toEqual(p);
    }
    expect(parsePeriodKey("Q:2026-5:1")).toBeNull();
    expect(parsePeriodKey("garbage")).toBeNull();
  });

  it("lists available periods newest first", () => {
    const periods = availablePeriods(["2026-01", "2026-02", "2026-03", "2026-04"], "quarter");
    expect(periods.map((p) => p.label)).toEqual(["Q2 2026", "Q1 2026"]);
  });
});

describe("ratios", () => {
  const months = ["2025-07", "2025-08", "2025-09", "2025-10", "2025-11", "2025-12", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05"];
  const d = emptyDataset({
    asOfDate: "2026-06-15",
    monthlyPnl: [
      ...months.map((m) => pnlMonth(m, 100_000, { "COGS:Labor": 60_000, Rent: 20_000, "Other:Interest Expense": 2_000 })),
      pnlMonth("2026-06", 50_000, { "COGS:Labor": 30_000 }, true),
    ],
    balanceSheets: [simpleBalanceSheet("2026-06-15", { cash: 150_000, ar: 120_000, ap: 60_000, otherCl: 40_000, equity: 170_000 })],
    coverage: { ...emptyDataset().coverage, profitAndLoss: true, balanceSheet: true },
  });
  const ratios = computeRatios(d);
  const v = (id: string) => findRatio(ratios, id)?.value;

  it("computes liquidity ratios from the latest balance sheet", () => {
    expect(v("current-ratio")).toBeCloseTo(270_000 / 100_000);
    expect(v("quick-ratio")).toBeCloseTo(270_000 / 100_000);
    expect(v("working-capital")).toBe(170_000);
    expect(v("liabilities-to-equity")).toBeCloseTo(100_000 / 170_000);
  });

  it("computes margins over closed months only, excluding the partial month", () => {
    expect(v("gross-margin")).toBeCloseTo(0.4);
    expect(v("net-margin")).toBeCloseTo(0.18);
    expect(v("interest-coverage")).toBeCloseTo(20_000 / 2_000);
  });

  it("computes DSO from the last three closed months", () => {
    // Mar-May 2026 = 92 days, revenue 300k -> 3,260.87/day; AR 120k -> 36.8 days
    expect(v("dso")).toBeCloseTo(120_000 / (300_000 / 92), 5);
  });

  it("returns null with a reason when data is missing", () => {
    const none = computeRatios(emptyDataset());
    for (const r of none) {
      expect(r.value).toBeNull();
      expect(r.unavailableReason).toBeTruthy();
    }
    expect(findRatio(computeRatios(emptyDataset()), "dpo")?.value).toBeNull();
  });
});

describe("headline metrics", () => {
  it("reports cash from bank lines of the as-of balance sheet", () => {
    const d = emptyDataset({ balanceSheets: [simpleBalanceSheet("2026-06-15", { cash: 42_000, ar: 0, ap: 0, equity: 42_000 })], coverage: { ...emptyDataset().coverage, balanceSheet: true } });
    expect(cashPosition(d)?.amount).toBe(42_000);
  });

  it("returns null cash when no balance sheet or bank accounts exist", () => {
    expect(cashPosition(emptyDataset())).toBeNull();
  });

  it("falls back to bank account balances when the balance sheet is older than the as-of date", () => {
    const d = emptyDataset({
      accounts: [{ id: "1", name: "Checking", type: "Bank", subType: null, classification: "Asset", currentBalance: 9_000, active: true }],
      balanceSheets: [simpleBalanceSheet("2026-05-31", { cash: 1, ar: 0, ap: 0, equity: 1 })],
      coverage: { ...emptyDataset().coverage, accounts: true, balanceSheet: true },
    });
    expect(cashPosition(d)).toMatchObject({ amount: 9_000, basis: "bank-account-balances" });
  });

  it("compares the last closed month with the prior month", () => {
    const d = emptyDataset({
      monthlyPnl: [pnlMonth("2026-04", 100_000, { Rent: 50_000 }), pnlMonth("2026-05", 110_000, { Rent: 60_000 }), pnlMonth("2026-06", 1, {}, true)],
      coverage: { ...emptyDataset().coverage, profitAndLoss: true },
    });
    const c = lastClosedMonthComparison(d)!;
    expect(c.month).toBe("2026-05");
    expect(c.revenueChange).toBeCloseTo(0.1);
    expect(c.netIncomeChange).toBeCloseTo(0);
  });

  it("flags significant expense increases using both thresholds", () => {
    const d = emptyDataset({
      monthlyPnl: [
        pnlMonth("2026-01", 1, { Fuel: 10_000, Software: 1_000 }),
        pnlMonth("2026-02", 1, { Fuel: 10_000, Software: 1_000 }),
        pnlMonth("2026-03", 1, { Fuel: 10_000, Software: 1_000 }),
        pnlMonth("2026-04", 1, { Fuel: 10_500, Software: 1_000 }),
        pnlMonth("2026-05", 1, { Fuel: 14_000, Software: 2_000 }),
      ],
      coverage: { ...emptyDataset().coverage, profitAndLoss: true },
    });
    const r = expenseChanges(d)!;
    const fuel = r.changes.find((c) => c.account === "Fuel")!;
    const software = r.changes.find((c) => c.account === "Software")!;
    expect(fuel.significant).toBe(true); // +3,500 and +33%
    expect(software.significant).toBe(false); // +100% but only $1,000
  });

  it("marks health indicators unavailable when inputs are missing", () => {
    const h = healthIndicators(emptyDataset());
    expect(h.every((x) => x.status === "unavailable" && x.summary === "Not available")).toBe(true);
  });

  it("verifies balance sheet totals", () => {
    const s = summarizeBalanceSheet(simpleBalanceSheet("2026-06-15", { cash: 100, ar: 50, ap: 30, equity: 120 }));
    expect(s.totalAssets).toBe(150);
    expect(s.totalLiabilitiesAndEquity).toBe(150);
    expect(s.balances).toBe(true);
  });
});
