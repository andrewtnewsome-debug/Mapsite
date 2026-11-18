import type { FinancialDataset, Invoice, Bill, Payment, MonthlyPnl, BalanceSheetSnapshot } from "@/lib/domain/types";

export function emptyDataset(overrides: Partial<FinancialDataset> = {}): FinancialDataset {
  return {
    source: "demo",
    company: { id: "t", name: "Test Co", currency: "USD", fiscalYearStartMonth: 1 },
    asOfDate: "2026-06-15",
    syncedAt: null,
    accounts: [],
    customers: [],
    vendors: [],
    invoices: [],
    bills: [],
    payments: [],
    monthlyPnl: [],
    balanceSheets: [],
    monthlyCashFlow: [],
    sourceArAging: null,
    managementAssumptions: null,
    coverage: {
      company: true,
      accounts: false,
      customers: false,
      invoices: false,
      bills: false,
      payments: false,
      profitAndLoss: false,
      balanceSheet: false,
      cashFlow: false,
      arAgingReport: false,
    },
    warnings: [],
    ...overrides,
  };
}

let seq = 0;
export function invoice(p: Partial<Invoice> & { balance: number }): Invoice {
  seq += 1;
  return {
    id: p.id ?? `i${seq}`,
    docNumber: p.docNumber ?? String(1000 + seq),
    customerId: p.customerId ?? "c1",
    customerName: p.customerName ?? "Customer One",
    txnDate: p.txnDate ?? "2026-05-01",
    dueDate: p.dueDate === undefined ? "2026-05-31" : p.dueDate,
    totalAmount: p.totalAmount ?? p.balance,
    balance: p.balance,
    lines: p.lines ?? [],
  };
}

export function bill(p: Partial<Bill> & { balance: number }): Bill {
  seq += 1;
  return {
    id: p.id ?? `b${seq}`,
    docNumber: p.docNumber ?? `B${seq}`,
    vendorId: p.vendorId ?? "v1",
    vendorName: p.vendorName ?? "Vendor One",
    txnDate: p.txnDate ?? "2026-06-01",
    dueDate: p.dueDate === undefined ? "2026-07-01" : p.dueDate,
    totalAmount: p.totalAmount ?? p.balance,
    balance: p.balance,
    category: p.category ?? null,
  };
}

export function payment(p: Partial<Payment> & { amount: number; applied: Payment["applied"] }): Payment {
  seq += 1;
  return {
    id: p.id ?? `p${seq}`,
    customerId: p.customerId ?? "c1",
    customerName: p.customerName ?? "Customer One",
    txnDate: p.txnDate ?? "2026-06-01",
    amount: p.amount,
    applied: p.applied,
    unappliedAmount: p.unappliedAmount ?? 0,
  };
}

export function pnlMonth(month: string, revenue: number, costs: Record<string, number>, isPartial = false): MonthlyPnl {
  const lines: MonthlyPnl["lines"] = [{ account: "Revenue", category: "income", amount: revenue }];
  for (const [account, amount] of Object.entries(costs)) {
    const category = account.startsWith("COGS:") ? "cogs" : account.startsWith("Other:") ? "otherExpense" : "expense";
    lines.push({ account: account.replace(/^(COGS|Other):/, ""), category, amount });
  }
  const [y, m] = month.split("-").map(Number);
  const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  return { month, isPartial, endDate: end, lines };
}

export function simpleBalanceSheet(date: string, v: { cash: number; ar: number; ap: number; equity: number; otherCl?: number }): BalanceSheetSnapshot {
  return {
    date,
    lines: [
      { section: "bank", account: "Checking", amount: v.cash },
      { section: "accountsReceivable", account: "Accounts Receivable", amount: v.ar },
      { section: "accountsPayable", account: "Accounts Payable", amount: v.ap },
      { section: "otherCurrentLiabilities", account: "Accrued", amount: v.otherCl ?? 0 },
      { section: "equity", account: "Equity", amount: v.equity },
    ],
  };
}
