/**
 * Accounts receivable aging (and the shared aging math used for payables).
 *
 * Definitions (deterministic, documented in the UI):
 * - Days overdue = as-of date minus due date, in whole calendar days.
 * - An invoice due today is "Current" (0 days overdue).
 * - When a due date is missing, the invoice date is used and the row is flagged.
 * - Only the remaining balance is aged, so partially paid invoices age correctly.
 */

import type { Bill, Invoice, Payment } from "@/lib/domain/types";
import { daysBetween } from "@/lib/domain/dates";
import { roundCents, safeDivide, sum } from "@/lib/domain/money";

export type AgingBucket = "current" | "1-30" | "31-60" | "61-90" | "90+";

export const AGING_BUCKETS: { key: AgingBucket; label: string; shortLabel: string }[] = [
  { key: "current", label: "Current", shortLabel: "Current" },
  { key: "1-30", label: "1-30 days overdue", shortLabel: "1-30" },
  { key: "31-60", label: "31-60 days overdue", shortLabel: "31-60" },
  { key: "61-90", label: "61-90 days overdue", shortLabel: "61-90" },
  { key: "90+", label: "More than 90 days overdue", shortLabel: "90+" },
];

/** Balances below half a cent are treated as fully paid. */
const PAID_EPSILON = 0.005;

export function bucketForDaysOverdue(daysOverdue: number): AgingBucket {
  if (daysOverdue <= 0) return "current";
  if (daysOverdue <= 30) return "1-30";
  if (daysOverdue <= 60) return "31-60";
  if (daysOverdue <= 90) return "61-90";
  return "90+";
}

export function daysOverdue(dueDate: string | null, txnDate: string, asOfDate: string): number {
  return daysBetween(dueDate ?? txnDate, asOfDate);
}

export type PaymentStatus = "unpaid" | "partially-paid";

export interface OpenInvoice {
  id: string;
  docNumber: string | null;
  customerId: string;
  customerName: string;
  txnDate: string;
  dueDate: string | null;
  /** Due date used for aging (invoice date when the due date is missing). */
  effectiveDueDate: string;
  dueDateMissing: boolean;
  totalAmount: number;
  balance: number;
  amountPaid: number;
  daysOverdue: number;
  bucket: AgingBucket;
  status: PaymentStatus;
}

export function openInvoicesAsOf(invoices: readonly Invoice[], asOfDate: string): OpenInvoice[] {
  return invoices
    .filter((inv) => inv.txnDate <= asOfDate && inv.balance > PAID_EPSILON)
    .map((inv) => {
      const dOver = daysOverdue(inv.dueDate, inv.txnDate, asOfDate);
      const balance = roundCents(inv.balance);
      const amountPaid = roundCents(Math.max(0, inv.totalAmount - balance));
      return {
        id: inv.id,
        docNumber: inv.docNumber,
        customerId: inv.customerId,
        customerName: inv.customerName,
        txnDate: inv.txnDate,
        dueDate: inv.dueDate,
        effectiveDueDate: inv.dueDate ?? inv.txnDate,
        dueDateMissing: inv.dueDate == null,
        totalAmount: roundCents(inv.totalAmount),
        balance,
        amountPaid,
        daysOverdue: dOver,
        bucket: bucketForDaysOverdue(dOver),
        status: amountPaid > PAID_EPSILON ? "partially-paid" : "unpaid",
      } satisfies OpenInvoice;
    })
    .sort((a, b) => b.daysOverdue - a.daysOverdue || b.balance - a.balance);
}

export interface BucketTotal {
  amount: number;
  count: number;
  /** Share of total open balance, 0-1. null when there is no open balance. */
  share: number | null;
}

export interface AgingSummary {
  asOfDate: string;
  total: number;
  openInvoiceCount: number;
  buckets: Record<AgingBucket, BucketTotal>;
  overdueAmount: number;
  overdueCount: number;
  /** Overdue balance / total open balance. */
  overdueShareOfBalance: number | null;
  /** Overdue invoices / open invoices (by count). */
  overdueShareOfInvoices: number | null;
  over60Amount: number;
  over90Amount: number;
  partiallyPaidCount: number;
  missingDueDateCount: number;
}

interface AgeableItem {
  balance: number;
  bucket: AgingBucket;
  status?: PaymentStatus;
  dueDateMissing?: boolean;
}

export function summarizeAging(items: readonly AgeableItem[], asOfDate: string): AgingSummary {
  const total = sum(items.map((i) => i.balance));
  const buckets = Object.fromEntries(
    AGING_BUCKETS.map(({ key }) => {
      const inBucket = items.filter((i) => i.bucket === key);
      const amount = sum(inBucket.map((i) => i.balance));
      return [key, { amount, count: inBucket.length, share: safeDivide(amount, total) }];
    }),
  ) as Record<AgingBucket, BucketTotal>;
  const overdue = items.filter((i) => i.bucket !== "current");
  const overdueAmount = sum(overdue.map((i) => i.balance));
  return {
    asOfDate,
    total,
    openInvoiceCount: items.length,
    buckets,
    overdueAmount,
    overdueCount: overdue.length,
    overdueShareOfBalance: safeDivide(overdueAmount, total),
    overdueShareOfInvoices: safeDivide(overdue.length, items.length),
    over60Amount: roundCents(buckets["61-90"].amount + buckets["90+"].amount),
    over90Amount: buckets["90+"].amount,
    partiallyPaidCount: items.filter((i) => i.status === "partially-paid").length,
    missingDueDateCount: items.filter((i) => i.dueDateMissing).length,
  };
}

export interface CustomerBalance {
  customerId: string;
  customerName: string;
  total: number;
  overdue: number;
  buckets: Record<AgingBucket, number>;
  openInvoiceCount: number;
  overdueInvoiceCount: number;
  oldestDaysOverdue: number;
  /** Balance-weighted average days overdue across overdue invoices only. */
  weightedDaysOverdue: number;
  /** Share of total AR, 0-1. */
  shareOfTotal: number | null;
}

export function customerBalances(open: readonly OpenInvoice[]): CustomerBalance[] {
  const total = sum(open.map((i) => i.balance));
  const byCustomer = new Map<string, OpenInvoice[]>();
  for (const inv of open) {
    const list = byCustomer.get(inv.customerId) ?? [];
    list.push(inv);
    byCustomer.set(inv.customerId, list);
  }
  return [...byCustomer.entries()]
    .map(([customerId, invs]) => {
      const overdueInvs = invs.filter((i) => i.daysOverdue > 0);
      const overdue = sum(overdueInvs.map((i) => i.balance));
      const buckets = Object.fromEntries(
        AGING_BUCKETS.map(({ key }) => [key, sum(invs.filter((i) => i.bucket === key).map((i) => i.balance))]),
      ) as Record<AgingBucket, number>;
      const weighted =
        overdue > 0 ? overdueInvs.reduce((acc, i) => acc + i.daysOverdue * i.balance, 0) / overdue : 0;
      const customerTotal = sum(invs.map((i) => i.balance));
      return {
        customerId,
        customerName: invs[0].customerName,
        total: customerTotal,
        overdue,
        buckets,
        openInvoiceCount: invs.length,
        overdueInvoiceCount: overdueInvs.length,
        oldestDaysOverdue: Math.max(0, ...invs.map((i) => i.daysOverdue)),
        weightedDaysOverdue: Math.round(weighted),
        shareOfTotal: safeDivide(customerTotal, total),
      };
    })
    .sort((a, b) => b.total - a.total);
}

export type PriorityLevel = "high" | "medium" | "low";

export interface CollectionsPriority extends CustomerBalance {
  score: number;
  level: PriorityLevel;
  reasons: string[];
}

/**
 * Collections priority score (0-100), deterministic and explainable:
 *   40 pts  overdue balance relative to the largest overdue balance
 *   35 pts  balance-weighted days overdue (capped at 90 days)
 *   25 pts  share of the customer's overdue balance that is more than 60 days late
 * High >= 60, Medium >= 35, otherwise Low. Customers with nothing overdue are excluded.
 */
export function collectionsPriorities(balances: readonly CustomerBalance[]): CollectionsPriority[] {
  const overdueCustomers = balances.filter((b) => b.overdue > 0);
  const maxOverdue = Math.max(0, ...overdueCustomers.map((b) => b.overdue));
  return overdueCustomers
    .map((b) => {
      const balancePts = maxOverdue > 0 ? (b.overdue / maxOverdue) * 40 : 0;
      const agePts = Math.min(1, b.weightedDaysOverdue / 90) * 35;
      const severe = b.buckets["61-90"] + b.buckets["90+"];
      const severePts = b.overdue > 0 ? (severe / b.overdue) * 25 : 0;
      const score = Math.round(balancePts + agePts + severePts);
      const level: PriorityLevel = score >= 60 ? "high" : score >= 35 ? "medium" : "low";
      const reasons: string[] = [];
      reasons.push(`${b.overdueInvoiceCount} overdue invoice${b.overdueInvoiceCount === 1 ? "" : "s"}`);
      reasons.push(`oldest ${b.oldestDaysOverdue} days past due`);
      if (severe > 0) reasons.push(`${Math.round((severe / b.overdue) * 100)}% of overdue balance is over 60 days`);
      return { ...b, score, level, reasons };
    })
    .sort((a, b) => b.score - a.score || b.overdue - a.overdue);
}

/**
 * Reconstruct invoice balances at an earlier date by adding back payments
 * applied after that date to today's balance. Invoices issued after the date
 * are excluded. This keeps credits applied before the date correct and relies
 * only on recorded customer payments.
 */
export function invoicesAsOfEarlierDate(
  invoices: readonly Invoice[],
  payments: readonly Payment[],
  earlierDate: string,
): Invoice[] {
  const paidAfter = new Map<string, number>();
  for (const p of payments) {
    if (p.txnDate <= earlierDate) continue;
    for (const a of p.applied) paidAfter.set(a.invoiceId, (paidAfter.get(a.invoiceId) ?? 0) + a.amount);
  }
  return invoices
    .filter((inv) => inv.txnDate <= earlierDate)
    .map((inv) => ({
      ...inv,
      balance: roundCents(Math.min(inv.totalAmount, inv.balance + (paidAfter.get(inv.id) ?? 0))),
    }));
}

/* ------------------------------------------------------------------ payables */

export interface OpenBill {
  id: string;
  docNumber: string | null;
  vendorId: string;
  vendorName: string;
  txnDate: string;
  dueDate: string | null;
  effectiveDueDate: string;
  dueDateMissing: boolean;
  totalAmount: number;
  balance: number;
  daysOverdue: number;
  bucket: AgingBucket;
  category: string | null;
}

export function openBillsAsOf(bills: readonly Bill[], asOfDate: string): OpenBill[] {
  return bills
    .filter((b) => b.txnDate <= asOfDate && b.balance > PAID_EPSILON)
    .map((b) => {
      const dOver = daysOverdue(b.dueDate, b.txnDate, asOfDate);
      return {
        id: b.id,
        docNumber: b.docNumber,
        vendorId: b.vendorId,
        vendorName: b.vendorName,
        txnDate: b.txnDate,
        dueDate: b.dueDate,
        effectiveDueDate: b.dueDate ?? b.txnDate,
        dueDateMissing: b.dueDate == null,
        totalAmount: roundCents(b.totalAmount),
        balance: roundCents(b.balance),
        daysOverdue: dOver,
        bucket: bucketForDaysOverdue(dOver),
        category: b.category,
      };
    })
    .sort((a, b) => (a.effectiveDueDate < b.effectiveDueDate ? -1 : 1));
}

export interface PayablesSummary {
  total: number;
  overdue: number;
  overdueCount: number;
  dueNext7Days: number;
  dueNext30Days: number;
  billCount: number;
  aging: AgingSummary;
}

export function summarizePayables(open: readonly OpenBill[], asOfDate: string): PayablesSummary {
  const dueWithin = (days: number) => sum(open.filter((b) => b.daysOverdue <= 0 && b.daysOverdue > -days - 1).map((b) => b.balance));
  const overdue = open.filter((b) => b.daysOverdue > 0);
  return {
    total: sum(open.map((b) => b.balance)),
    overdue: sum(overdue.map((b) => b.balance)),
    overdueCount: overdue.length,
    dueNext7Days: dueWithin(7),
    dueNext30Days: dueWithin(30),
    billCount: open.length,
    aging: summarizeAging(open, asOfDate),
  };
}
