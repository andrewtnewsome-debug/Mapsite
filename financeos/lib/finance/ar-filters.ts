import { z } from "zod";
import type { AgingBucket, OpenInvoice } from "./aging";

/** Filters for the unpaid invoice list. Shared by the AR page and the CSV export. */
export const ArFilterSchema = z.object({
  customer: z.string().max(100).optional(),
  bucket: z.enum(["all", "overdue", "current", "1-30", "31-60", "61-90", "90+"]).default("all"),
  minBalance: z.coerce.number().min(0).max(1e12).optional(),
  maxBalance: z.coerce.number().min(0).max(1e12).optional(),
  dueFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dueTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  status: z.enum(["all", "unpaid", "partially-paid"]).default("all"),
});

export type ArFilters = z.infer<typeof ArFilterSchema>;

export function applyArFilters(invoices: readonly OpenInvoice[], f: ArFilters): OpenInvoice[] {
  return invoices.filter((inv) => {
    if (f.customer && inv.customerId !== f.customer) return false;
    if (f.bucket === "overdue" && inv.daysOverdue <= 0) return false;
    if (f.bucket !== "all" && f.bucket !== "overdue" && inv.bucket !== (f.bucket as AgingBucket)) return false;
    if (f.minBalance != null && inv.balance < f.minBalance) return false;
    if (f.maxBalance != null && inv.balance > f.maxBalance) return false;
    if (f.dueFrom && inv.effectiveDueDate < f.dueFrom) return false;
    if (f.dueTo && inv.effectiveDueDate > f.dueTo) return false;
    if (f.status !== "all" && inv.status !== f.status) return false;
    return true;
  });
}

export function parseArFilters(params: URLSearchParams | Record<string, string | undefined>): ArFilters {
  const obj = params instanceof URLSearchParams ? Object.fromEntries(params.entries()) : params;
  const cleaned = Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined && v !== ""));
  const parsed = ArFilterSchema.safeParse(cleaned);
  return parsed.success ? parsed.data : ArFilterSchema.parse({});
}
