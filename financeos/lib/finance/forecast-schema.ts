import { z } from "zod";
import type { FinancialDataset } from "@/lib/domain/types";
import { FORECAST_WEEKS } from "./forecast";

const money = z.number().finite().min(0).max(1e10);

export const OneTimeItemSchema = z.object({
  id: z.string().min(1).max(40),
  label: z.string().trim().min(1).max(80),
  week: z.number().int().min(1).max(FORECAST_WEEKS),
  amount: z.number().finite().positive().max(1e10),
  direction: z.enum(["inflow", "outflow"]),
});

export const ForecastAssumptionsSchema = z.object({
  collectionRate: z.number().min(0).max(1),
  collectionDelayDays: z.number().int().min(0).max(365),
  weeklyNewBillings: money,
  newBillingsCollectionDays: z.number().int().min(0).max(365),
  weeklyPayroll: money,
  payrollFrequency: z.enum(["weekly", "biweekly"]),
  weeklyRecurringExpenses: money,
  vendorCostPctOfBillings: z.number().min(0).max(1),
  vendorPaymentDays: z.number().int().min(0).max(365),
  billPaymentDelayDays: z.number().int().min(0).max(365),
  weeklyDebtService: money,
  oneTimeItems: z.array(OneTimeItemSchema).max(50),
  minimumCashBalance: z.number().finite().min(0).max(1e10).nullable(),
});

/** A trimmed dataset with only what the client-side forecast needs (open items and the latest balance sheet). */
export function forecastDataset(ds: FinancialDataset): FinancialDataset {
  const latest = ds.balanceSheets.filter((b) => b.date <= ds.asOfDate).slice(-1);
  return {
    ...ds,
    accounts: ds.accounts.filter((a) => a.type === "Bank"),
    customers: [],
    vendors: [],
    invoices: ds.invoices.filter((i) => i.balance > 0.005).map((i) => ({ ...i, lines: [] })),
    bills: ds.bills.filter((b) => b.balance > 0.005),
    payments: [],
    monthlyPnl: [],
    monthlyCashFlow: [],
    balanceSheets: latest,
    warnings: [],
  };
}
