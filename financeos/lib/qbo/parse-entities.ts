/**
 * Maps QuickBooks Online entities to the canonical model.
 * Every field is treated as optional; malformed records are skipped and counted.
 */

import type { Account, AccountClassification, Bill, Customer, Invoice, InvoiceLine, Payment, Vendor } from "@/lib/domain/types";
import { isIsoDate } from "@/lib/domain/dates";
import { parseAmount, roundCents } from "@/lib/domain/money";

type Ref = { value?: string; name?: string } | undefined;

interface QboLine {
  Amount?: number | string;
  Description?: string;
  DetailType?: string;
  SalesItemLineDetail?: { ItemRef?: Ref; Qty?: number | string; UnitPrice?: number | string };
  AccountBasedExpenseLineDetail?: { AccountRef?: Ref };
  ItemBasedExpenseLineDetail?: { ItemRef?: Ref };
  LinkedTxn?: { TxnId?: string; TxnType?: string }[];
}

export interface QboInvoice {
  Id?: string;
  DocNumber?: string;
  TxnDate?: string;
  DueDate?: string;
  TotalAmt?: number | string;
  Balance?: number | string;
  CustomerRef?: Ref;
  Line?: QboLine[];
}

export interface QboBill {
  Id?: string;
  DocNumber?: string;
  TxnDate?: string;
  DueDate?: string;
  TotalAmt?: number | string;
  Balance?: number | string;
  VendorRef?: Ref;
  Line?: QboLine[];
}

export interface QboPayment {
  Id?: string;
  TxnDate?: string;
  TotalAmt?: number | string;
  UnappliedAmt?: number | string;
  CustomerRef?: Ref;
  Line?: QboLine[];
}

export interface QboAccount {
  Id?: string;
  Name?: string;
  FullyQualifiedName?: string;
  AccountType?: string;
  AccountSubType?: string;
  Classification?: string;
  CurrentBalance?: number | string;
  Active?: boolean;
}

export interface QboCustomer {
  Id?: string;
  DisplayName?: string;
  CompanyName?: string;
  PrimaryEmailAddr?: { Address?: string };
  Active?: boolean;
  Balance?: number | string;
}

export interface QboVendor {
  Id?: string;
  DisplayName?: string;
  CompanyName?: string;
  Active?: boolean;
  Balance?: number | string;
}

export interface QboCompanyInfo {
  CompanyInfo?: { CompanyName?: string; LegalName?: string; FiscalYearStartMonth?: string; Country?: string };
}

export interface ParseStats {
  skipped: number;
  missingDueDates: number;
}

const date = (v: unknown): string | null => (typeof v === "string" && isIsoDate(v) ? v : null);
const num = (v: unknown): number | null => parseAmount(typeof v === "number" ? v : typeof v === "string" ? v : null);

export function mapInvoices(raw: QboInvoice[], stats: ParseStats): Invoice[] {
  const out: Invoice[] = [];
  for (const r of raw) {
    const txnDate = date(r.TxnDate);
    const total = num(r.TotalAmt);
    if (!r.Id || !txnDate || total == null || !r.CustomerRef?.value) {
      stats.skipped += 1;
      continue;
    }
    const due = date(r.DueDate);
    if (!due) stats.missingDueDates += 1;
    const balance = num(r.Balance) ?? 0;
    const lines: InvoiceLine[] = (r.Line ?? [])
      .filter((l) => l.DetailType === "SalesItemLineDetail" || l.DetailType === "DescriptionOnly" || l.DetailType === "DiscountLineDetail")
      .map((l) => {
        const d = l.SalesItemLineDetail;
        const amount = num(l.Amount) ?? 0;
        return {
          description: (l.Description ?? d?.ItemRef?.name ?? "").slice(0, 300),
          itemName: d?.ItemRef?.name ?? null,
          quantity: d?.Qty != null ? num(d.Qty) : null,
          unitPrice: d?.UnitPrice != null ? num(d.UnitPrice) : null,
          amount: l.DetailType === "DiscountLineDetail" ? -Math.abs(amount) : amount,
        };
      });
    out.push({
      id: r.Id,
      docNumber: r.DocNumber ?? null,
      customerId: r.CustomerRef.value,
      customerName: r.CustomerRef.name ?? `Customer ${r.CustomerRef.value}`,
      txnDate,
      dueDate: due,
      totalAmount: total,
      balance: roundCents(Math.max(0, Math.min(balance, Math.max(total, balance)))),
      lines,
    });
  }
  return out;
}

export function mapBills(raw: QboBill[], stats: ParseStats): Bill[] {
  const out: Bill[] = [];
  for (const r of raw) {
    const txnDate = date(r.TxnDate);
    const total = num(r.TotalAmt);
    if (!r.Id || !txnDate || total == null) {
      stats.skipped += 1;
      continue;
    }
    const firstAccount = (r.Line ?? []).find((l) => l.AccountBasedExpenseLineDetail?.AccountRef?.name)?.AccountBasedExpenseLineDetail?.AccountRef?.name ?? null;
    out.push({
      id: r.Id,
      docNumber: r.DocNumber ?? null,
      vendorId: r.VendorRef?.value ?? "unknown",
      vendorName: r.VendorRef?.name ?? "Unknown vendor",
      txnDate,
      dueDate: date(r.DueDate),
      totalAmount: total,
      balance: roundCents(Math.max(0, num(r.Balance) ?? 0)),
      category: firstAccount,
    });
  }
  return out;
}

export function mapPayments(raw: QboPayment[], stats: ParseStats): Payment[] {
  const out: Payment[] = [];
  for (const r of raw) {
    const txnDate = date(r.TxnDate);
    const total = num(r.TotalAmt);
    if (!r.Id || !txnDate || total == null || !r.CustomerRef?.value) {
      stats.skipped += 1;
      continue;
    }
    const applied = (r.Line ?? []).flatMap((l) =>
      (l.LinkedTxn ?? []).filter((t) => t.TxnType === "Invoice" && t.TxnId).map((t) => ({ invoiceId: t.TxnId as string, amount: num(l.Amount) ?? 0 })),
    );
    out.push({
      id: r.Id,
      customerId: r.CustomerRef.value,
      customerName: r.CustomerRef.name ?? `Customer ${r.CustomerRef.value}`,
      txnDate,
      amount: total,
      applied,
      unappliedAmount: num(r.UnappliedAmt) ?? 0,
    });
  }
  return out;
}

const CLASSIFICATIONS = new Set(["Asset", "Liability", "Equity", "Revenue", "Expense"]);

export function mapAccounts(raw: QboAccount[]): Account[] {
  return raw
    .filter((r) => r.Id && (r.Name || r.FullyQualifiedName))
    .map((r) => ({
      id: r.Id!,
      name: r.FullyQualifiedName ?? r.Name!,
      type: r.AccountType ?? "Unknown",
      subType: r.AccountSubType ?? null,
      classification: CLASSIFICATIONS.has(r.Classification ?? "") ? (r.Classification as AccountClassification) : null,
      currentBalance: num(r.CurrentBalance),
      active: r.Active !== false,
    }));
}

export function mapCustomers(raw: QboCustomer[]): Customer[] {
  return raw
    .filter((r) => r.Id)
    .map((r) => ({
      id: r.Id!,
      name: r.DisplayName ?? r.CompanyName ?? `Customer ${r.Id}`,
      email: r.PrimaryEmailAddr?.Address ?? null,
      active: r.Active !== false,
      reportedBalance: num(r.Balance),
    }));
}

export function mapVendors(raw: QboVendor[]): Vendor[] {
  return raw
    .filter((r) => r.Id)
    .map((r) => ({ id: r.Id!, name: r.DisplayName ?? r.CompanyName ?? `Vendor ${r.Id}`, active: r.Active !== false, reportedBalance: num(r.Balance) }));
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

export function fiscalStartMonth(info: QboCompanyInfo | null): number {
  const name = info?.CompanyInfo?.FiscalYearStartMonth?.toLowerCase();
  const idx = name ? MONTHS.indexOf(name) : -1;
  return idx >= 0 ? idx + 1 : 1;
}
