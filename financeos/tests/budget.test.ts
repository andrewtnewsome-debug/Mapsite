import { describe, expect, it } from "vitest";
import { budgetVsActual, currentFiscalYear, draftBudgetFromHistory, setAnnual, spread } from "@/lib/finance/budget";
import { buildDemoDataset } from "@/lib/demo/generate";
import { summarizePnl } from "@/lib/finance/statements";
import { emptyDataset, pnlMonth } from "./helpers/fixtures";

const ds = buildDemoDataset("2026-11-18", { generatedAt: "t" });

describe("budget spreading", () => {
  it("follows the pattern and sums exactly to the annual amount", () => {
    const months = ["2026-01", "2026-02", "2026-03"];
    const s = spread(1000, months, { "2026-01": 1, "2026-02": 2, "2026-03": 1 });
    expect(s).toEqual({ "2026-01": 250, "2026-02": 500, "2026-03": 250 });
    const even = spread(100, months, {});
    expect(Object.values(even).reduce((a, b) => a + b, 0)).toBeCloseTo(100, 2);
    expect(even["2026-01"]).toBe(33.33);
  });
});

describe("drafting from history", () => {
  it("builds the current fiscal year from prior-year actuals with growth", () => {
    const fy = currentFiscalYear(ds);
    expect(fy.months[0]).toBe("2026-01");
    const b = draftBudgetFromHistory(ds, { income: 0.1, expense: 0.05 }, "t");
    const priorRevenue = summarizePnl(ds.monthlyPnl.filter((m) => m.month >= "2025-01" && m.month <= "2025-12")).revenue;
    const budgetRevenue = b.lines.filter((l) => l.category === "income").reduce((s, l) => s + l.annual, 0);
    expect(budgetRevenue).toBeCloseTo(priorRevenue * 1.1, 0);
    for (const l of b.lines) expect(Object.values(l.monthly).reduce((a, x) => a + x, 0)).toBeCloseTo(l.annual, 1);
    // keeps seasonality: July budget above February for contract revenue
    const contract = b.lines.find((l) => l.account === "Contract Services Revenue")!;
    expect(contract.monthly["2026-07"]).toBeGreaterThan(contract.monthly["2026-02"]);
  });

  it("re-spreads an edited annual amount with the same pattern", () => {
    const b = draftBudgetFromHistory(ds, { income: 0, expense: 0 }, "t");
    const line = b.lines.find((l) => l.account === "Insurance")!;
    const edited = setAnnual(b, "Insurance", "expense", line.annual * 2, "t2");
    const after = edited.lines.find((l) => l.account === "Insurance")!;
    expect(after.annual).toBeCloseTo(line.annual * 2, 1);
    expect(after.monthly["2026-06"]).toBeCloseTo(line.monthly["2026-06"] * 2, 0);
    expect(edited.updatedAt).toBe("t2");
  });
});

describe("variance", () => {
  const d = emptyDataset({
    asOfDate: "2026-03-15",
    monthlyPnl: [
      pnlMonth("2025-01", 100, { Rent: 50 }),
      pnlMonth("2025-02", 100, { Rent: 50 }),
      pnlMonth("2025-03", 100, { Rent: 50 }),
      pnlMonth("2026-01", 130, { Rent: 40 }),
      pnlMonth("2026-02", 90, { Rent: 70 }),
      pnlMonth("2026-03", 10, { Rent: 5 }, true),
    ],
    coverage: { ...emptyDataset().coverage, profitAndLoss: true },
  });

  it("compares closed months only and marks favorability by category", () => {
    const b = draftBudgetFromHistory(d, { income: 0, expense: 0 }, "t");
    // months without history use the account average (100 revenue / 50 rent)
    expect(b.lines.find((l) => l.account === "Revenue")!.annual).toBe(1200);
    const v = budgetVsActual(d, b, ["2026-01", "2026-02", "2026-03"]);
    expect(v.actualMonths).toEqual(["2026-01", "2026-02"]);
    const rev = v.rows.find((r) => r.account === "Revenue")!;
    expect(rev).toMatchObject({ budget: 200, actual: 220, variance: 20, favorable: true });
    const rent = v.rows.find((r) => r.account === "Rent")!;
    expect(rent).toMatchObject({ budget: 100, actual: 110, variance: 10, favorable: false });
    expect(v.totals.netIncomeBudget).toBe(100);
    expect(v.totals.netIncomeActual).toBe(110);
  });
});

describe("AI budget tool", () => {
  it("routes budget questions and reports variances, or explains that no budget exists", async () => {
    const { routeQuestion } = await import("@/lib/ai/router");
    const { runTool } = await import("@/lib/ai/tools");
    expect(routeQuestion("Are we on budget this year?", ds).calls.map((c) => c.id)).toContain("budget_variance");
    expect(routeQuestion("How are we doing against plan?", ds).calls.map((c) => c.id)).toContain("budget_variance");
    expect(runTool(ds, { id: "budget_variance", params: {} }).available).toBe(false);
    const budget = draftBudgetFromHistory(ds, { income: 0.1, expense: 0.05 }, "t");
    const r = runTool(ds, { id: "budget_variance", params: {} }, { budget });
    expect(r.available).toBe(true);
    expect(r.facts.find((f) => f.label === "Year-to-date revenue, budget")?.basis).toBe("assumption");
    expect(r.summary).toMatch(/Through October 2026, revenue is \$[\d,]+ against a budget of \$[\d,]+/);
  });
});
