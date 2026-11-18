import { describe, expect, it } from "vitest";
import {
  bucketForDaysOverdue,
  collectionsPriorities,
  customerBalances,
  invoicesAsOfEarlierDate,
  openBillsAsOf,
  openInvoicesAsOf,
  summarizeAging,
  summarizePayables,
} from "@/lib/finance/aging";
import { bill, invoice, payment } from "./helpers/fixtures";

const AS_OF = "2026-06-15";

describe("aging buckets and date boundaries", () => {
  it("treats due today as current and the next day as 1-30", () => {
    expect(bucketForDaysOverdue(-10)).toBe("current");
    expect(bucketForDaysOverdue(0)).toBe("current");
    expect(bucketForDaysOverdue(1)).toBe("1-30");
    expect(bucketForDaysOverdue(30)).toBe("1-30");
    expect(bucketForDaysOverdue(31)).toBe("31-60");
    expect(bucketForDaysOverdue(60)).toBe("31-60");
    expect(bucketForDaysOverdue(61)).toBe("61-90");
    expect(bucketForDaysOverdue(90)).toBe("61-90");
    expect(bucketForDaysOverdue(91)).toBe("90+");
  });

  it("computes days overdue from the due date across month and leap-year boundaries", () => {
    const open = openInvoicesAsOf(
      [
        invoice({ id: "a", dueDate: "2026-06-15", balance: 100 }), // due today
        invoice({ id: "b", dueDate: "2026-06-14", balance: 100 }), // 1 day
        invoice({ id: "c", dueDate: "2026-05-16", balance: 100 }), // 30 days
        invoice({ id: "d", dueDate: "2026-05-15", balance: 100 }), // 31 days
        invoice({ id: "e", dueDate: "2026-03-17", balance: 100 }), // 90 days
        invoice({ id: "f", dueDate: "2026-03-16", balance: 100 }), // 91 days
      ],
      AS_OF,
    );
    const byId = Object.fromEntries(open.map((o) => [o.id, o]));
    expect(byId.a.daysOverdue).toBe(0);
    expect(byId.a.bucket).toBe("current");
    expect(byId.b.bucket).toBe("1-30");
    expect(byId.c.daysOverdue).toBe(30);
    expect(byId.c.bucket).toBe("1-30");
    expect(byId.d.bucket).toBe("31-60");
    expect(byId.e.bucket).toBe("61-90");
    expect(byId.f.bucket).toBe("90+");

    const leap = openInvoicesAsOf([invoice({ dueDate: "2028-02-28", txnDate: "2028-01-29", balance: 1 })], "2028-03-01");
    expect(leap[0].daysOverdue).toBe(2); // Feb 29 exists in 2028
  });

  it("excludes paid invoices and invoices dated after the as-of date", () => {
    const open = openInvoicesAsOf(
      [
        invoice({ id: "paid", balance: 0, totalAmount: 500 }),
        invoice({ id: "dust", balance: 0.004, totalAmount: 500 }),
        invoice({ id: "future", txnDate: "2026-06-20", dueDate: "2026-07-20", balance: 300 }),
        invoice({ id: "open", balance: 250 }),
      ],
      AS_OF,
    );
    expect(open.map((o) => o.id)).toEqual(["open"]);
  });

  it("uses the invoice date when the due date is missing and flags it", () => {
    const open = openInvoicesAsOf([invoice({ txnDate: "2026-06-01", dueDate: null, balance: 100 })], AS_OF);
    expect(open[0].dueDateMissing).toBe(true);
    expect(open[0].daysOverdue).toBe(14);
    expect(summarizeAging(open, AS_OF).missingDueDateCount).toBe(1);
  });
});

describe("partial payments", () => {
  it("ages only the remaining balance and marks the invoice partially paid", () => {
    const open = openInvoicesAsOf([invoice({ totalAmount: 10_000, balance: 4_250.5, dueDate: "2026-04-01" })], AS_OF);
    expect(open[0].balance).toBe(4_250.5);
    expect(open[0].amountPaid).toBe(5_749.5);
    expect(open[0].status).toBe("partially-paid");
    const s = summarizeAging(open, AS_OF);
    expect(s.total).toBe(4_250.5);
    expect(s.buckets["61-90"].amount).toBe(4_250.5);
    expect(s.partiallyPaidCount).toBe(1);
  });

  it("reconstructs earlier balances by adding back later payments", () => {
    const invs = [
      invoice({ id: "x", txnDate: "2026-04-01", dueDate: "2026-05-01", totalAmount: 1000, balance: 0 }),
      invoice({ id: "y", txnDate: "2026-04-10", dueDate: "2026-05-10", totalAmount: 800, balance: 300 }),
      invoice({ id: "z", txnDate: "2026-06-01", dueDate: "2026-07-01", totalAmount: 500, balance: 500 }),
    ];
    const pays = [
      payment({ txnDate: "2026-05-05", amount: 1000, applied: [{ invoiceId: "x", amount: 1000 }] }),
      payment({ txnDate: "2026-06-10", amount: 500, applied: [{ invoiceId: "y", amount: 500 }] }),
    ];
    const earlier = invoicesAsOfEarlierDate(invs, pays, "2026-05-15");
    const byId = Object.fromEntries(earlier.map((i) => [i.id, i.balance]));
    expect(byId.x).toBe(0); // paid before the date
    expect(byId.y).toBe(800); // the later 500 payment is added back
    expect(byId.z).toBeUndefined(); // not yet issued
  });
});

describe("aging summary and customer aggregation", () => {
  const open = openInvoicesAsOf(
    [
      invoice({ customerId: "a", customerName: "Alpha", dueDate: "2026-07-01", balance: 1000 }),
      invoice({ customerId: "a", customerName: "Alpha", dueDate: "2026-06-05", balance: 500 }),
      invoice({ customerId: "a", customerName: "Alpha", dueDate: "2026-03-01", balance: 250, totalAmount: 400 }),
      invoice({ customerId: "b", customerName: "Beta", dueDate: "2026-05-01", balance: 2000 }),
      invoice({ customerId: "c", customerName: "Gamma", dueDate: "2026-06-30", balance: 300 }),
    ],
    AS_OF,
  );

  it("totals buckets that reconcile to the open balance", () => {
    const s = summarizeAging(open, AS_OF);
    expect(s.total).toBe(4050);
    const bucketSum = Object.values(s.buckets).reduce((a, b) => a + b.amount, 0);
    expect(bucketSum).toBe(4050);
    expect(s.overdueAmount).toBe(2750);
    expect(s.overdueCount).toBe(3);
    expect(s.overdueShareOfInvoices).toBeCloseTo(3 / 5);
    expect(s.overdueShareOfBalance).toBeCloseTo(2750 / 4050);
    expect(s.over60Amount).toBe(250);
    expect(s.over90Amount).toBe(250);
  });

  it("aggregates balances by customer and ranks by total", () => {
    const customers = customerBalances(open);
    expect(customers.map((c) => c.customerName)).toEqual(["Beta", "Alpha", "Gamma"]);
    const alpha = customers.find((c) => c.customerId === "a")!;
    expect(alpha.total).toBe(1750);
    expect(alpha.overdue).toBe(750);
    expect(alpha.openInvoiceCount).toBe(3);
    expect(alpha.overdueInvoiceCount).toBe(2);
    expect(alpha.oldestDaysOverdue).toBe(106);
    // weighted: (10*500 + 106*250) / 750 = 42
    expect(alpha.weightedDaysOverdue).toBe(42);
    expect(customers.reduce((a, c) => a + (c.shareOfTotal ?? 0), 0)).toBeCloseTo(1);
  });

  it("scores collections priority deterministically and excludes customers with nothing overdue", () => {
    const priorities = collectionsPriorities(customerBalances(open));
    expect(priorities.map((p) => p.customerName)).toEqual(["Beta", "Alpha"]);
    const beta = priorities[0];
    // balance 40 pts (largest) + age min(1, 45/90)*35 = 17.5 -> 57.5 + 0 severe = 58 (rounded)
    expect(beta.score).toBe(58);
    expect(beta.level).toBe("medium");
    const alpha = priorities[1];
    // balance 750/2000*40 = 15, age 42/90*35 = 16.33, severe 250/750*25 = 8.33 -> 40
    expect(alpha.score).toBe(40);
    expect(alpha.reasons.join(" ")).toContain("over 60 days");
  });

  it("handles an empty ledger without dividing by zero", () => {
    const s = summarizeAging([], AS_OF);
    expect(s.total).toBe(0);
    expect(s.overdueShareOfBalance).toBeNull();
    expect(s.overdueShareOfInvoices).toBeNull();
    expect(customerBalances([])).toEqual([]);
    expect(collectionsPriorities([])).toEqual([]);
  });
});

describe("payables", () => {
  it("separates overdue bills and bills due in the next 7 and 30 days", () => {
    const open = openBillsAsOf(
      [
        bill({ dueDate: "2026-06-10", balance: 100 }), // overdue
        bill({ dueDate: "2026-06-15", balance: 200 }), // due today
        bill({ dueDate: "2026-06-22", balance: 300 }), // in 7 days
        bill({ dueDate: "2026-06-23", balance: 400 }), // in 8 days
        bill({ dueDate: "2026-07-15", balance: 500 }), // in 30 days
        bill({ dueDate: "2026-07-16", balance: 600 }), // in 31 days
      ],
      AS_OF,
    );
    const s = summarizePayables(open, AS_OF);
    expect(s.total).toBe(2100);
    expect(s.overdue).toBe(100);
    expect(s.dueNext7Days).toBe(500);
    expect(s.dueNext30Days).toBe(1400);
  });
});
