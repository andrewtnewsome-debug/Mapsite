/**
 * Collections assistant: deterministic plan per overdue customer with
 * suggested next actions and a reminder email draft that references the
 * exact invoice numbers and balances. Nothing is ever sent automatically.
 */

import type { FinancialDataset } from "@/lib/domain/types";
import { formatIsoDate } from "@/lib/domain/dates";
import { sum } from "@/lib/domain/money";
import { formatCurrency } from "@/lib/format";
import type { CollectionsPriority, OpenInvoice } from "./aging";
import { receivablesSnapshot } from "./metrics";

export type CollectionStage = "reminder" | "follow-up" | "escalation" | "final-notice";
export type DraftTone = "friendly" | "firm" | "final";

export const STAGE_LABELS: Record<CollectionStage, string> = {
  reminder: "Friendly reminder",
  "follow-up": "Follow-up",
  escalation: "Escalation",
  "final-notice": "Final notice",
};

export interface CollectionPlan {
  customerId: string;
  customerName: string;
  email: string | null;
  priority: CollectionsPriority;
  stage: CollectionStage;
  overdueInvoices: OpenInvoice[];
  totalOverdue: number;
  oldestDaysOverdue: number;
  hasPartialPayments: boolean;
  nextActions: string[];
  recommendedTone: DraftTone;
}

export function stageFor(oldestDaysOverdue: number): CollectionStage {
  if (oldestDaysOverdue > 90) return "final-notice";
  if (oldestDaysOverdue > 60) return "escalation";
  if (oldestDaysOverdue > 30) return "follow-up";
  return "reminder";
}

const TONE_FOR_STAGE: Record<CollectionStage, DraftTone> = { reminder: "friendly", "follow-up": "firm", escalation: "firm", "final-notice": "final" };

export function nextActionsFor(stage: CollectionStage, hasPartial: boolean, hasEmail: boolean): string[] {
  const a: string[] = [];
  if (!hasEmail) a.push("Find the customer's accounts payable contact; no email address is on file.");
  switch (stage) {
    case "reminder":
      a.push("Send a friendly reminder email with the invoice details.");
      a.push("Confirm the invoice was received and approved for payment.");
      break;
    case "follow-up":
      a.push("Send a firm follow-up email and attach a statement of open invoices.");
      a.push("Call the accounts payable contact to confirm a payment date.");
      break;
    case "escalation":
      a.push("Call the decision-maker, not only accounts payable, and ask for a firm payment date.");
      a.push("Ask whether any invoice is disputed and resolve the dispute quickly.");
      a.push("Consider pausing new non-contract work until the balance is current.");
      break;
    case "final-notice":
      a.push("Send a final notice with a specific payment deadline.");
      a.push("Offer a short written payment plan if the customer cannot pay in full.");
      a.push("Review the contract's late-payment terms and decide whether to involve a collections agency or attorney.");
      break;
  }
  if (hasPartial) a.push("Reference the partial payments received and confirm the remaining balance.");
  return a;
}

export function buildCollectionPlans(dataset: FinancialDataset): CollectionPlan[] {
  const ar = receivablesSnapshot(dataset);
  if (!ar) return [];
  const emails = new Map(dataset.customers.map((c) => [c.id, c.email]));
  return ar.priorities.map((p) => {
    const overdueInvoices = ar.open.filter((i) => i.customerId === p.customerId && i.daysOverdue > 0).sort((a, b) => b.daysOverdue - a.daysOverdue);
    const stage = stageFor(p.oldestDaysOverdue);
    const hasPartial = overdueInvoices.some((i) => i.status === "partially-paid");
    const email = emails.get(p.customerId) ?? null;
    return {
      customerId: p.customerId,
      customerName: p.customerName,
      email,
      priority: p,
      stage,
      overdueInvoices,
      totalOverdue: sum(overdueInvoices.map((i) => i.balance)),
      oldestDaysOverdue: p.oldestDaysOverdue,
      hasPartialPayments: hasPartial,
      nextActions: nextActionsFor(stage, hasPartial, Boolean(email)),
      recommendedTone: TONE_FOR_STAGE[stage],
    };
  });
}

export interface EmailDraft {
  subject: string;
  body: string;
}

export function draftReminderEmail(plan: Pick<CollectionPlan, "customerName" | "overdueInvoices" | "totalOverdue">, companyName: string, tone: DraftTone, asOfDate: string): EmailDraft {
  const lines = plan.overdueInvoices.map((i) => {
    const partial = i.status === "partially-paid" ? ` (original ${formatCurrency(i.totalAmount, { cents: true })}, ${formatCurrency(i.amountPaid, { cents: true })} received)` : "";
    return `- Invoice #${i.docNumber ?? i.id}, dated ${formatIsoDate(i.txnDate)}, due ${formatIsoDate(i.effectiveDueDate)}: ${formatCurrency(i.balance, { cents: true })} outstanding${partial}`;
  });
  const count = plan.overdueInvoices.length;
  const total = formatCurrency(plan.totalOverdue, { cents: true });
  const invoiceWord = count === 1 ? "invoice" : "invoices";
  const subjects: Record<DraftTone, string> = {
    friendly: `Payment reminder: ${count} open ${invoiceWord} from ${companyName}`,
    firm: `Past due: ${total} owed to ${companyName}`,
    final: `Final notice: ${total} past due to ${companyName}`,
  };
  const openings: Record<DraftTone, string> = {
    friendly: `I hope all is well. This is a friendly reminder that the following ${invoiceWord} from ${companyName} ${count === 1 ? "is" : "are"} now past due:`,
    firm: `Our records show the following ${invoiceWord} remain${count === 1 ? "s" : ""} unpaid past the due date:`,
    final: `Despite our earlier reminders, the following ${invoiceWord} remain${count === 1 ? "s" : ""} unpaid:`,
  };
  const asks: Record<DraftTone, string> = {
    friendly: "If payment has already been sent, thank you, and please disregard this note. Otherwise, could you let us know when we can expect payment? We are happy to resend copies of any invoice.",
    firm: "Please arrange payment or reply with the expected payment date by the end of this week. If anything on these invoices is in question, let us know right away so we can resolve it.",
    final: "Please arrange payment of the full balance within 10 days of this notice, or contact us to agree on a written payment plan. If we do not hear from you, we will need to review next steps under our agreement.",
  };
  const body = [
    `Hello ${plan.customerName} accounts payable team,`,
    "",
    openings[tone],
    "",
    ...lines,
    "",
    `Total past due as of ${formatIsoDate(asOfDate)}: ${total}`,
    "",
    asks[tone],
    "",
    "Thank you,",
    "[Your name]",
    companyName,
  ].join("\n");
  return { subject: subjects[tone], body };
}
