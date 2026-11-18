import type { FinancialDataset } from "@/lib/domain/types";
import { addDays } from "@/lib/domain/dates";
import { safeDivide, sum } from "@/lib/domain/money";

export interface CustomerRevenue {
  customerId: string;
  customerName: string;
  invoiced: number;
  invoiceCount: number;
  share: number | null;
}

/**
 * Amount invoiced per customer over the trailing `days` (invoice totals, before
 * credits). Used for revenue concentration; it approximates revenue on an
 * invoiced basis and is labeled as such in the UI.
 */
export function invoicedByCustomer(dataset: FinancialDataset, days = 365): { since: string; total: number; customers: CustomerRevenue[] } | null {
  if (!dataset.coverage.invoices) return null;
  const since = addDays(dataset.asOfDate, -days + 1);
  const recent = dataset.invoices.filter((i) => i.txnDate >= since && i.txnDate <= dataset.asOfDate);
  const total = sum(recent.map((i) => i.totalAmount));
  const map = new Map<string, CustomerRevenue>();
  for (const inv of recent) {
    const c = map.get(inv.customerId) ?? { customerId: inv.customerId, customerName: inv.customerName, invoiced: 0, invoiceCount: 0, share: null };
    c.invoiced += inv.totalAmount;
    c.invoiceCount += 1;
    map.set(inv.customerId, c);
  }
  const customers = [...map.values()]
    .map((c) => ({ ...c, invoiced: Math.round(c.invoiced * 100) / 100, share: safeDivide(c.invoiced, total) }))
    .sort((a, b) => b.invoiced - a.invoiced);
  return { since, total, customers };
}
