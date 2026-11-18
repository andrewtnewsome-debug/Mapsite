/**
 * Pure assembly of a canonical FinancialDataset from raw QuickBooks responses.
 * Partial failures (e.g. one report unavailable) are recorded as coverage
 * gaps and warnings instead of failing the whole sync.
 */

import type { FinancialDataset } from "@/lib/domain/types";
import type { QboError } from "./errors";
import {
  fiscalStartMonth,
  mapAccounts,
  mapBills,
  mapCustomers,
  mapInvoices,
  mapPayments,
  mapVendors,
  type ParseStats,
  type QboAccount,
  type QboBill,
  type QboCompanyInfo,
  type QboCustomer,
  type QboInvoice,
  type QboPayment,
  type QboVendor,
} from "./parse-entities";
import { parseAgedReceivables, parseBalanceSheet, parseCashFlow, parseProfitAndLoss, type QboReport } from "./parse-reports";

type Settled<T> = { ok: true; value: T } | { ok: false; error: Pick<QboError, "message" | "code"> };

export interface QboRawData {
  asOfDate: string;
  companyInfo: QboCompanyInfo | null;
  accounts: Settled<QboAccount[]>;
  customers: Settled<QboCustomer[]>;
  vendors: Settled<QboVendor[]>;
  invoices: Settled<QboInvoice[]>;
  bills: Settled<QboBill[]>;
  payments: Settled<QboPayment[]>;
  pnl: Settled<QboReport>;
  balanceSheet: Settled<QboReport>;
  cashFlow: Settled<QboReport>;
  aging: Settled<QboReport>;
}

export function assembleQboDataset(raw: QboRawData, realmId: string, syncedAt: string): FinancialDataset {
  const warnings: string[] = [];
  const stats: ParseStats = { skipped: 0, missingDueDates: 0 };
  const val = <T>(s: Settled<T>, label: string, fallback: T): T => {
    if (s.ok) return s.value;
    warnings.push(`${label} could not be loaded from QuickBooks: ${s.error.message}`);
    return fallback;
  };

  const info = raw.companyInfo?.CompanyInfo;
  const accounts = mapAccounts(val(raw.accounts, "Accounts", []));
  const customers = mapCustomers(val(raw.customers, "Customers", []));
  const vendors = mapVendors(val(raw.vendors, "Vendors", []));
  const invoices = mapInvoices(val(raw.invoices, "Invoices", []), stats);
  const bills = mapBills(val(raw.bills, "Bills", []), stats);
  const payments = mapPayments(val(raw.payments, "Payments", []), stats);

  const pnl = raw.pnl.ok ? parseProfitAndLoss(raw.pnl.value, raw.asOfDate) : null;
  if (!raw.pnl.ok) val(raw.pnl, "Profit and Loss report", null);
  const bs = raw.balanceSheet.ok ? parseBalanceSheet(raw.balanceSheet.value) : null;
  if (!raw.balanceSheet.ok) val(raw.balanceSheet, "Balance Sheet report", null);
  const cf = raw.cashFlow.ok ? parseCashFlow(raw.cashFlow.value, raw.asOfDate) : null;
  if (!raw.cashFlow.ok) val(raw.cashFlow, "Cash Flow report", null);
  const aging = raw.aging.ok ? parseAgedReceivables(raw.aging.value, raw.asOfDate) : null;
  if (!raw.aging.ok) val(raw.aging, "A/R Aging report", null);

  warnings.push(...(pnl?.warnings ?? []), ...(bs?.warnings ?? []), ...(cf?.warnings ?? []));
  if (stats.skipped > 0) warnings.push(`${stats.skipped} QuickBooks record(s) were skipped because required fields (id, date, amount or customer) were missing.`);
  const openMissingDue = invoices.filter((i) => i.balance > 0 && !i.dueDate).length;
  if (openMissingDue > 0) warnings.push(`${openMissingDue} open invoice(s) have no due date; FinanceOS ages them from the invoice date.`);
  const unapplied = payments.reduce((s, p) => s + (p.unappliedAmount > 0 ? p.unappliedAmount : 0), 0);
  if (unapplied > 0.005) warnings.push(`Customer payments include ${unapplied.toFixed(2)} of unapplied credit, which QuickBooks may net against receivables.`);

  // Drop balance sheet snapshots after the as-of date and keep the last one as of the as-of date.
  const snapshots = (bs?.snapshots ?? []).filter((s) => s.date <= raw.asOfDate).sort((a, b) => (a.date < b.date ? -1 : 1));

  return {
    source: "quickbooks-sandbox",
    company: {
      id: `qbo-${realmId}`,
      name: info?.CompanyName?.trim() || "QuickBooks Sandbox Company",
      legalName: info?.LegalName ?? null,
      industry: null,
      currency: raw.pnl.ok ? (raw.pnl.value.Header?.Currency ?? "USD") : "USD",
      fiscalYearStartMonth: fiscalStartMonth(raw.companyInfo),
      realmId,
    },
    asOfDate: raw.asOfDate,
    syncedAt,
    accounts,
    customers,
    vendors,
    invoices,
    bills,
    payments,
    monthlyPnl: pnl?.months ?? [],
    balanceSheets: snapshots,
    monthlyCashFlow: cf?.months ?? [],
    sourceArAging: aging,
    managementAssumptions: null,
    coverage: {
      company: raw.companyInfo != null,
      accounts: raw.accounts.ok,
      customers: raw.customers.ok,
      invoices: raw.invoices.ok,
      bills: raw.bills.ok,
      payments: raw.payments.ok,
      profitAndLoss: Boolean(pnl && pnl.months.length),
      balanceSheet: snapshots.length > 0,
      cashFlow: Boolean(cf && cf.months.length),
      arAgingReport: aging != null,
    },
    warnings,
  };
}
