import { describe, expect, it } from "vitest";
import { buildDemoDataset } from "@/lib/demo/generate";
import { openInvoicesAsOf, summarizeAging } from "@/lib/finance/aging";
import { summarizeBalanceSheet, summarizeCashFlow, summarizePnl } from "@/lib/finance/statements";
import { generateInsights } from "@/lib/finance/insights";
import { buildManagementSummary, managementSummaryToText } from "@/lib/finance/summary";
import { sum } from "@/lib/domain/money";

const AS_OF = "2026-11-18";
const d = buildDemoDataset(AS_OF, { generatedAt: "2026-11-18T12:00:00.000Z" });

describe("demo company is internally consistent", () => {
  it("is deterministic", () => {
    const again = buildDemoDataset(AS_OF, { generatedAt: "2026-11-18T12:00:00.000Z" });
    expect(JSON.stringify(again)).toBe(JSON.stringify(d));
  });

  it("has annual revenue between $5M and $10M", () => {
    const ttm = summarizePnl(d.monthlyPnl.filter((m) => !m.isPartial).slice(-12));
    expect(ttm.revenue).toBeGreaterThan(5_000_000);
    expect(ttm.revenue).toBeLessThan(10_000_000);
    expect(ttm.netIncome).toBeGreaterThan(0);
  });

  it("balances every balance sheet (assets = liabilities + equity)", () => {
    for (const snap of d.balanceSheets) {
      const s = summarizeBalanceSheet(snap);
      expect(Math.abs(s.totalAssets - s.totalLiabilitiesAndEquity)).toBeLessThan(0.05);
    }
  });

  it("ties accounts receivable on the balance sheet to open invoice balances", () => {
    const bs = summarizeBalanceSheet(d.balanceSheets[d.balanceSheets.length - 1]);
    const open = openInvoicesAsOf(d.invoices, AS_OF);
    expect(bs.accountsReceivable).toBeCloseTo(summarizeAging(open, AS_OF).total, 2);
    const ap = sum(d.bills.map((b) => b.balance));
    expect(bs.accountsPayable).toBeCloseTo(ap, 2);
  });

  it("reconciles cash flow: beginning + net change = ending, and ending = balance sheet cash", () => {
    d.monthlyCashFlow.forEach((m, i) => {
      const s = summarizeCashFlow([m]);
      expect(m.beginningCash! + s.netChange).toBeCloseTo(m.endingCash!, 1);
      expect(summarizeBalanceSheet(d.balanceSheets[i]).cash).toBeCloseTo(m.endingCash!, 2);
      if (i > 0) expect(m.beginningCash).toBe(d.monthlyCashFlow[i - 1].endingCash);
    });
  });

  it("matches net income on the P&L and the cash flow statement", () => {
    d.monthlyPnl.forEach((m, i) => {
      const ni = summarizePnl([m]).netIncome;
      const cfNi = d.monthlyCashFlow[i].lines.find((l) => l.label === "Net Income")!.amount;
      expect(cfNi).toBeCloseTo(ni, 2);
    });
  });

  it("keeps cash positive in every month", () => {
    for (const m of d.monthlyCashFlow) expect(m.endingCash!).toBeGreaterThan(0);
  });

  it("applies payments to invoices consistently (paid = total - balance)", () => {
    const paidByInvoice = new Map<string, number>();
    for (const p of d.payments) {
      expect(sum(p.applied.map((a) => a.amount))).toBeCloseTo(p.amount, 2);
      for (const a of p.applied) paidByInvoice.set(a.invoiceId, (paidByInvoice.get(a.invoiceId) ?? 0) + a.amount);
    }
    for (const inv of d.invoices) {
      expect(inv.totalAmount - inv.balance).toBeCloseTo(paidByInvoice.get(inv.id) ?? 0, 2);
      expect(inv.balance).toBeGreaterThanOrEqual(0);
      expect(sum(inv.lines.map((l) => l.amount))).toBeCloseTo(inv.totalAmount, 2);
    }
  });

  it("includes realistic collection issues: partial payments and every aging bucket", () => {
    const open = openInvoicesAsOf(d.invoices, AS_OF);
    const s = summarizeAging(open, AS_OF);
    expect(s.partiallyPaidCount).toBeGreaterThan(0);
    for (const b of ["current", "1-30", "31-60", "61-90", "90+"] as const) expect(s.buckets[b].amount).toBeGreaterThan(0);
  });

  it("labels the data as demonstration data", () => {
    expect(d.source).toBe("demo");
    expect(d.company.legalName).toContain("fictional");
    expect(d.customers.every((c) => c.email?.endsWith(".example"))).toBe(true);
  });

  it("produces insights and a management summary", () => {
    const insights = generateInsights(d);
    const ids = insights.map((i) => i.id);
    expect(ids).toContain("over-90");
    expect(ids.some((id) => id.startsWith("expense-"))).toBe(true);
    for (const i of insights) {
      expect(i.trigger.length).toBeGreaterThan(10);
      expect(i.facts.length + i.forecasts.length).toBeGreaterThan(0);
    }
    const text = managementSummaryToText(buildManagementSummary(d, "2026-11-18T12:00:00.000Z"));
    expect(text).toContain("Demo Company");
    expect(text).toContain("KEY FINANCIAL RISKS");
    expect(text).not.toContain("NaN");
  });

  it("works for an as-of date at the end of a month and the start of a year", () => {
    for (const asOf of ["2026-12-31", "2027-01-01", "2028-02-29"]) {
      const x = buildDemoDataset(asOf, { generatedAt: "t" });
      const last = x.balanceSheets[x.balanceSheets.length - 1];
      expect(last.date).toBe(asOf);
      const s = summarizeBalanceSheet(last);
      expect(Math.abs(s.totalAssets - s.totalLiabilitiesAndEquity)).toBeLessThan(0.05);
    }
  });
});
