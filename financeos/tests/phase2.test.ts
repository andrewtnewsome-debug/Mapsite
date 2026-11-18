import { describe, expect, it } from "vitest";
import { buildCollectionPlans, draftReminderEmail, nextActionsFor, stageFor } from "@/lib/finance/collections";
import { computeInvoiceTotals, customerTerms, parseInvoiceRequest, parseLineClause } from "@/lib/finance/invoice-draft";
import { generateInsights } from "@/lib/finance/insights";
import { buildDemoDataset } from "@/lib/demo/generate";
import { toCsv } from "@/lib/csv";

const ds = buildDemoDataset("2026-11-18", { generatedAt: "t" });
const customers = [
  { id: "c1", name: "Granite Peak Properties", termsDays: 30 },
  { id: "c2", name: "Bluewater Credit Union", termsDays: 15 },
  { id: "c3", name: "Cool Cars", termsDays: null },
];
const TODAY = "2026-11-18";

describe("collections assistant", () => {
  it("assigns stages by days overdue", () => {
    expect(stageFor(5)).toBe("reminder");
    expect(stageFor(30)).toBe("reminder");
    expect(stageFor(31)).toBe("follow-up");
    expect(stageFor(61)).toBe("escalation");
    expect(stageFor(91)).toBe("final-notice");
    expect(nextActionsFor("reminder", true, false).join(" ")).toMatch(/no email address|partial payments/);
  });

  it("builds plans only for customers with overdue balances, in priority order", () => {
    const plans = buildCollectionPlans(ds);
    expect(plans.length).toBeGreaterThan(0);
    expect(plans.every((p) => p.totalOverdue > 0 && p.overdueInvoices.every((i) => i.daysOverdue > 0))).toBe(true);
    expect(plans.map((p) => p.priority.score)).toEqual([...plans.map((p) => p.priority.score)].sort((a, b) => b - a));
  });

  it("drafts emails that cite every overdue invoice number and the exact total", () => {
    const plan = buildCollectionPlans(ds).find((p) => p.overdueInvoices.length > 1)!;
    for (const tone of ["friendly", "firm", "final"] as const) {
      const d = draftReminderEmail(plan, ds.company.name, tone, ds.asOfDate);
      for (const inv of plan.overdueInvoices) expect(d.body).toContain(`#${inv.docNumber}`);
      expect(d.body).toContain(plan.totalOverdue.toLocaleString("en-US", { style: "currency", currency: "USD" }));
      expect(d.body).toContain(ds.company.name);
    }
    expect(draftReminderEmail(plan, "X", "final", ds.asOfDate).subject).toMatch(/^Final notice/);
  });

  it("mentions partial payments in the draft", () => {
    const plan = buildCollectionPlans(ds).find((p) => p.hasPartialPayments)!;
    expect(draftReminderEmail(plan, "X", "firm", ds.asOfDate).body).toMatch(/received\)/);
  });
});

describe("invoice assistant parser", () => {
  it("parses quantities, unit prices, hours and the customer", () => {
    const r = parseInvoiceRequest("Bill Granite Peak Properties for 3 carpet extractions at $450 each and 6 hours of HVAC repair at $95/hour, net 30", customers, TODAY);
    expect(r.draft.customerId).toBe("c1");
    expect(r.draft.lines.map(({ id: _id, ...l }) => l)).toEqual([
      { quantity: 3, description: "Carpet extractions", unitPrice: 450 },
      { quantity: 6, description: "HVAC repair (hours)", unitPrice: 95 },
    ]);
    expect(r.draft.dueDate).toBe("2026-12-18");
    expect(r.draft.terms).toBe("Net 30");
    expect(r.warnings).toEqual([]);
    expect(computeInvoiceTotals(r.draft).total).toBe(1920);
  });

  it("handles flat amounts, number words and explicit due dates", () => {
    const r = parseInvoiceRequest("Invoice Bluewater for two filter replacements at $85, $1,250 for emergency boiler service; due December 15", customers, TODAY);
    expect(r.draft.customerName).toBe("Bluewater Credit Union");
    expect(r.draft.lines.map((l) => [l.quantity, l.description, l.unitPrice])).toEqual([
      [2, "Filter replacements", 85],
      [1, "Emergency boiler service", 1250],
    ]);
    expect(r.draft.dueDate).toBe("2026-12-15");
    expect(computeInvoiceTotals(r.draft).total).toBe(1420);
  });

  it("uses the customer's usual terms when none are given and warns about missing parts", () => {
    const r = parseInvoiceRequest("bill bluewater credit union for window cleaning for $600", customers, TODAY);
    expect(r.draft.dueDate).toBe("2026-12-03");
    expect(r.warnings[0]).toMatch(/usual terms/);
    const empty = parseInvoiceRequest("something vague", customers, TODAY);
    expect(empty.matched.customer).toBe(false);
    expect(empty.matched.lines).toBe(0);
    expect(empty.warnings.length).toBe(3);
  });

  it("parses individual clause shapes", () => {
    expect(parseLineClause("10 hrs of labor @ 80")).toEqual({ quantity: 10, description: "Labor (hours)", unitPrice: 80 });
    expect(parseLineClause("3 filters for $120")).toEqual({ quantity: 3, description: "Filters", unitPrice: 40 });
    expect(parseLineClause("hello")).toBeNull();
  });

  it("computes totals deterministically with cents", () => {
    const t = computeInvoiceTotals({ lines: [{ id: "a", description: "x", quantity: 3, unitPrice: 19.99 }, { id: "b", description: "y", quantity: 1.5, unitPrice: 0.1 }] });
    expect(t.lines.map((l) => l.amount)).toEqual([59.97, 0.15]);
    expect(t.total).toBe(60.12);
  });

  it("derives customer terms from invoice history", () => {
    const terms = customerTerms(ds.invoices);
    expect(terms.get("C-1010")).toBe(15);
    expect(terms.get("C-1003")).toBe(45);
  });
});

describe("insights", () => {
  it("separates facts, forecasts and assumptions", () => {
    const cash = generateInsights(ds).find((i) => i.category === "cash")!;
    expect(cash.facts.length).toBeGreaterThan(0);
    expect(cash.forecasts.length).toBeGreaterThan(0);
    expect(cash.assumptions.length).toBeGreaterThan(0);
  });
});

describe("CSV export safety", () => {
  it("quotes values and neutralizes spreadsheet formulas", () => {
    const csv = toCsv(["Name", "Amount"], [["=HYPERLINK(\"x\")", 5], ['Acme, "Inc"', -2.5], ["+cmd", null]]);
    expect(csv).toContain(`"'=HYPERLINK(""x"")",5`);
    expect(csv).toContain(`"Acme, ""Inc""",-2.5`);
    expect(csv).toContain("'+cmd,");
    expect(csv.startsWith("﻿")).toBe(true);
  });
});
