/**
 * Canonical financial data model.
 *
 * Every data source (the fictional demo company, QuickBooks Online sandbox, and
 * future integrations such as Xero or bank feeds) is mapped into a
 * FinancialDataset. All analytics, reports, forecasts and the AI CFO operate on
 * this shape only, so calculations are source-independent and testable.
 *
 * Conventions
 * - Dates are ISO calendar dates "YYYY-MM-DD" (no time zone). Months are "YYYY-MM".
 * - Money is a JavaScript number in the company currency, rounded to cents.
 * - A value that the source could not provide is `null`, never 0. The UI shows
 *   "Not available" for null.
 */

export type DataSourceKind = "demo" | "quickbooks-sandbox";

export const DATA_SOURCE_LABELS: Record<DataSourceKind, string> = {
  demo: "Demo Company",
  "quickbooks-sandbox": "QuickBooks Sandbox",
};

export interface CompanyProfile {
  /** Stable id within the local tenant. Future multi-company support keys on this. */
  id: string;
  name: string;
  legalName?: string | null;
  industry?: string | null;
  /** ISO 4217 code, e.g. "USD". */
  currency: string;
  /** 1 = January. Used for fiscal quarters and years. */
  fiscalYearStartMonth: number;
  /** QuickBooks company id (realmId). Only for QuickBooks sources. */
  realmId?: string | null;
}

export interface Customer {
  id: string;
  name: string;
  email: string | null;
  active: boolean;
  /** Open balance reported by the source system, if provided (QuickBooks Customer.Balance). */
  reportedBalance: number | null;
}

export interface Vendor {
  id: string;
  name: string;
  active: boolean;
  reportedBalance: number | null;
}

export interface InvoiceLine {
  description: string;
  itemName: string | null;
  quantity: number | null;
  unitPrice: number | null;
  amount: number;
}

export interface Invoice {
  id: string;
  docNumber: string | null;
  customerId: string;
  customerName: string;
  txnDate: string;
  /** null when the source did not provide a due date. Aging then treats it as due on the invoice date. */
  dueDate: string | null;
  totalAmount: number;
  /** Remaining unpaid amount. Partially paid invoices have 0 < balance < totalAmount. */
  balance: number;
  lines: InvoiceLine[];
}

export interface Bill {
  id: string;
  docNumber: string | null;
  vendorId: string;
  vendorName: string;
  txnDate: string;
  dueDate: string | null;
  totalAmount: number;
  balance: number;
  /** Expense account / category, when known. */
  category: string | null;
}

export interface PaymentApplication {
  invoiceId: string;
  amount: number;
}

export interface Payment {
  id: string;
  customerId: string;
  customerName: string;
  txnDate: string;
  amount: number;
  applied: PaymentApplication[];
  unappliedAmount: number;
}

export type AccountClassification = "Asset" | "Liability" | "Equity" | "Revenue" | "Expense";

export interface Account {
  id: string;
  name: string;
  /** Source account type, e.g. "Bank", "Accounts Receivable", "Expense". */
  type: string;
  subType: string | null;
  classification: AccountClassification | null;
  currentBalance: number | null;
  active: boolean;
}

export type PnlCategory = "income" | "cogs" | "expense" | "otherIncome" | "otherExpense";

export interface PnlLine {
  account: string;
  category: PnlCategory;
  amount: number;
}

export interface MonthlyPnl {
  /** "YYYY-MM" */
  month: string;
  /** True for the current month when it is not yet complete (month-to-date). */
  isPartial: boolean;
  /** Last date covered by this column (month end, or the as-of date for a partial month). */
  endDate: string;
  lines: PnlLine[];
}

export type BalanceSheetSection =
  | "bank"
  | "accountsReceivable"
  | "otherCurrentAssets"
  | "fixedAssets"
  | "otherAssets"
  | "accountsPayable"
  | "creditCards"
  | "otherCurrentLiabilities"
  | "longTermLiabilities"
  | "equity";

export interface BalanceSheetLine {
  section: BalanceSheetSection;
  account: string;
  amount: number;
}

export interface BalanceSheetSnapshot {
  /** Balance sheet date (month end, or as-of date for the latest snapshot). */
  date: string;
  lines: BalanceSheetLine[];
}

export type CashFlowSection = "operating" | "investing" | "financing";

export interface CashFlowLine {
  section: CashFlowSection;
  label: string;
  amount: number;
}

export interface MonthlyCashFlow {
  month: string;
  isPartial: boolean;
  endDate: string;
  lines: CashFlowLine[];
  beginningCash: number | null;
  endingCash: number | null;
}

/** Aging totals as reported by the source system (QuickBooks AgedReceivables), used to reconcile our own calculation. */
export interface SourceArAgingSummary {
  asOfDate: string;
  current: number | null;
  days1to30: number | null;
  days31to60: number | null;
  days61to90: number | null;
  over90: number | null;
  total: number | null;
}

/**
 * Operating assumptions supplied by management (not accounting facts).
 * For the demo company they come from a fictional payroll register and budget.
 */
export interface ManagementAssumptions {
  weeklyPayroll: number | null;
  weeklyPayrollSource: string;
  minimumCashBalance: number | null;
  notes: string[];
}

export interface DataCoverage {
  company: boolean;
  accounts: boolean;
  customers: boolean;
  invoices: boolean;
  bills: boolean;
  payments: boolean;
  profitAndLoss: boolean;
  balanceSheet: boolean;
  cashFlow: boolean;
  arAgingReport: boolean;
}

export interface FinancialDataset {
  source: DataSourceKind;
  company: CompanyProfile;
  /** Reporting date: every "current" figure is as of this date. */
  asOfDate: string;
  /** ISO timestamp of the last successful sync (or demo generation). */
  syncedAt: string | null;
  accounts: Account[];
  customers: Customer[];
  vendors: Vendor[];
  invoices: Invoice[];
  bills: Bill[];
  payments: Payment[];
  /** Ascending by month. */
  monthlyPnl: MonthlyPnl[];
  /** Ascending by date. The last snapshot is as of `asOfDate` when available. */
  balanceSheets: BalanceSheetSnapshot[];
  /** Ascending by month. */
  monthlyCashFlow: MonthlyCashFlow[];
  sourceArAging: SourceArAgingSummary | null;
  managementAssumptions: ManagementAssumptions | null;
  coverage: DataCoverage;
  /** Data quality notes shown to the user, e.g. "3 invoices have no due date". */
  warnings: string[];
}

/** A figure that may be unavailable. */
export type Maybe<T> = T | null;
