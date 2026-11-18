/**
 * Mocked QuickBooks Online API responses, shaped like real Intuit responses
 * (report Header/Columns/Rows trees with Section/Data rows, query responses
 * wrapped in QueryResponse, Fault error bodies).
 */
import type { QboReport, QboRow } from "@/lib/qbo/parse-reports";

const cd = (label: string, values: (string | number)[], id?: string) => ({
  ColData: [{ value: label, ...(id ? { id } : {}) }, ...values.map((v) => ({ value: typeof v === "number" ? v.toFixed(2) : v }))],
  type: "Data",
});

function section(group: string | undefined, header: string | null, rows: QboRow[], summaryLabel: string | null, summary: (string | number)[] | null, width: number): QboRow {
  return {
    ...(header ? { Header: { ColData: [{ value: header }, ...Array.from({ length: width }, () => ({ value: "" }))] } } : {}),
    ...(rows.length ? { Rows: { Row: rows } } : {}),
    ...(summaryLabel && summary ? { Summary: { ColData: [{ value: summaryLabel }, ...summary.map((v) => ({ value: typeof v === "number" ? v.toFixed(2) : v }))] } } : {}),
    type: "Section",
    ...(group ? { group } : {}),
  } as QboRow;
}

const monthColumns = [
  { ColTitle: "", ColType: "Account", MetaData: [{ Name: "ColKey", Value: "account" }] },
  { ColTitle: "Sep 2026", ColType: "Money", MetaData: [{ Name: "StartDate", Value: "2026-09-01" }, { Name: "EndDate", Value: "2026-09-30" }, { Name: "ColKey", Value: "Sep 2026" }] },
  { ColTitle: "Oct 2026", ColType: "Money", MetaData: [{ Name: "StartDate", Value: "2026-10-01" }, { Name: "EndDate", Value: "2026-10-31" }, { Name: "ColKey", Value: "Oct 2026" }] },
  { ColTitle: "Nov 1-18, 2026", ColType: "Money", MetaData: [{ Name: "StartDate", Value: "2026-11-01" }, { Name: "EndDate", Value: "2026-11-18" }, { Name: "ColKey", Value: "Nov 2026" }] },
  { ColTitle: "Total", ColType: "Money", MetaData: [{ Name: "ColKey", Value: "total" }] },
];

/** Profit and loss by month with a nested sub-account section (Landscaping Services > Job Materials / Labor). */
export const pnlReport: QboReport = {
  Header: { ReportName: "ProfitAndLoss", StartPeriod: "2026-09-01", EndPeriod: "2026-11-18", Currency: "USD" },
  Columns: { Column: monthColumns },
  Rows: {
    Row: [
      section(
        "Income",
        "Income",
        [
          cd("Design income", [1000, 1500, "", 2500], "82"),
          section(undefined, "Landscaping Services", [cd("Job Materials", [2000, 2200, 800, 5000], "46"), cd("Labor", [3000, 3300, 1200, 7500], "47")], "Total Landscaping Services", [5000, 5500, 2000, 12500], 4),
        ],
        "Total Income",
        [6000, 7000, 2000, 15000],
        4,
      ),
      section("COGS", "Cost of Goods Sold", [cd("Cost of Goods Sold", [1500, 1800, 400, 3700], "80")], "Total Cost of Goods Sold", [1500, 1800, 400, 3700], 4),
      section("GrossProfit", null, [], "Gross Profit", [4500, 5200, 1600, 11300], 4),
      section(
        "Expenses",
        "Expenses",
        [cd("Advertising", [200, 250, "", 450], "7"), cd("Rent or Lease", [900, 900, 900, 2700], "17"), section(undefined, "Utilities", [cd("Gas and Electric", [120, 135, 60, 315], "76")], "Total Utilities", [120, 135, 60, 315], 4)],
        "Total Expenses",
        [1220, 1285, 960, 3465],
        4,
      ),
      section("NetOperatingIncome", null, [], "Net Operating Income", [3280, 3915, 640, 7835], 4),
      section("OtherExpenses", "Other Expenses", [cd("Miscellaneous", [80, "", "", 80], "14")], "Total Other Expenses", [80, 0, 0, 80], 4),
      section("NetOtherIncome", null, [], "Net Other Income", [-80, 0, 0, -80], 4),
      section("NetIncome", null, [], "Net Income", [3200, 3915, 640, 7755], 4),
    ],
  },
};

export const balanceSheetReport: QboReport = {
  Header: { ReportName: "BalanceSheet", StartPeriod: "2026-09-01", EndPeriod: "2026-11-18", Currency: "USD" },
  Columns: { Column: monthColumns },
  Rows: {
    Row: [
      section(
        "TotalAssets",
        "ASSETS",
        [
          section(
            "CurrentAssets",
            "Current Assets",
            [
              section("BankAccounts", "Bank Accounts", [cd("Checking", [1200, 1500, 1800, ""], "35"), cd("Savings", [800, 800, 800, ""], "36")], "Total Bank Accounts", [2000, 2300, 2600, ""], 4),
              section("AR", "Accounts Receivable", [cd("Accounts Receivable (A/R)", [5000, 5200, 5281.52, ""], "84")], "Total Accounts Receivable", [5000, 5200, 5281.52, ""], 4),
              section("OtherCurrentAssets", "Other Current Assets", [cd("Inventory Asset", [500, 500, 500, ""], "81")], "Total Other Current Assets", [500, 500, 500, ""], 4),
            ],
            "Total Current Assets",
            [7500, 8000, 8381.52, ""],
            4,
          ),
          section("FixedAssets", "Fixed Assets", [cd("Truck", [13000, 13000, 13000, ""], "37")], "Total Fixed Assets", [13000, 13000, 13000, ""], 4),
        ],
        "TOTAL ASSETS",
        [20500, 21000, 21381.52, ""],
        4,
      ),
      section(
        "TotalLiabilitiesAndEquity",
        "LIABILITIES AND EQUITY",
        [
          section(
            "Liabilities",
            "Liabilities",
            [
              section(
                "CurrentLiabilities",
                "Current Liabilities",
                [
                  section("AP", "Accounts Payable", [cd("Accounts Payable (A/P)", [1600, 1700, 1602.67, ""], "33")], "Total Accounts Payable", [1600, 1700, 1602.67, ""], 4),
                  section("CreditCards", "Credit Cards", [cd("Mastercard", [150, 160, 157.72, ""], "41")], "Total Credit Cards", [150, 160, 157.72, ""], 4),
                ],
                "Total Current Liabilities",
                [1750, 1860, 1760.39, ""],
                4,
              ),
              section("LongTermLiabilities", "Long-Term Liabilities", [cd("Notes Payable", [4000, 3900, 3800, ""], "43")], "Total Long-Term Liabilities", [4000, 3900, 3800, ""], 4),
            ],
            "Total Liabilities",
            [5750, 5760, 5560.39, ""],
            4,
          ),
          section("Equity", "Equity", [cd("Opening Balance Equity", [9000, 9000, 9000, ""], "34"), cd("Retained Earnings", [2550, 2325, 2386.13, ""], "2"), cd("Net Income", [3200, 3915, 4435, ""])], "Total Equity", [14750, 15240, 15821.13, ""], 4),
        ],
        "TOTAL LIABILITIES AND EQUITY",
        [20500, 21000, 21381.52, ""],
        4,
      ),
    ],
  },
};

export const cashFlowReport: QboReport = {
  Header: { ReportName: "CashFlow", StartPeriod: "2026-09-01", EndPeriod: "2026-11-18", Currency: "USD" },
  Columns: { Column: monthColumns },
  Rows: {
    Row: [
      section(
        "OperatingActivities",
        "OPERATING ACTIVITIES",
        [
          cd("Net Income", [3200, 3915, 640, 7755]),
          section("OperatingAdjustments", "Adjustments to reconcile Net Income to Net Cash provided by operations:", [cd("Accounts Receivable (A/R)", [-2900, -200, -81.52, -3181.52], "84"), cd("Accounts Payable (A/P)", [100, 100, -97.33, 102.67], "33")], "Total Adjustments", [-2800, -100, -178.85, -3078.85], 4),
        ],
        "Net cash provided by operating activities",
        [400, 3815, 461.15, 4676.15],
        4,
      ),
      section("InvestingActivities", "INVESTING ACTIVITIES", [cd("Truck", [0, 0, 0, 0], "37")], "Net cash provided by investing activities", [0, 0, 0, 0], 4),
      section("FinancingActivities", "FINANCING ACTIVITIES", [cd("Notes Payable", [-100, -100, -100, -300], "43"), cd("Owner Draw", [0, -3415, -61.15, -3476.15])], "Net cash provided by financing activities", [-100, -3515, -161.15, -3776.15], 4),
      section("CashIncrease", null, [], "NET CASH INCREASE FOR PERIOD", [300, 300, 300, 900], 4),
      section("BeginningCash", null, [], "Cash at beginning of period", [1700, 2000, 2300, 1700], 4),
      section("EndingCash", null, [], "CASH AT END OF PERIOD", [2000, 2300, 2600, 2600], 4),
    ],
  },
};

export const agedReceivablesReport: QboReport = {
  Header: { ReportName: "AgedReceivables", EndPeriod: "2026-11-18" },
  Columns: {
    Column: [
      { ColTitle: "", ColType: "Customer" },
      { ColTitle: "Current", ColType: "Money" },
      { ColTitle: "1 - 30", ColType: "Money" },
      { ColTitle: "31 - 60", ColType: "Money" },
      { ColTitle: "61 - 90", ColType: "Money" },
      { ColTitle: "91 and over", ColType: "Money" },
      { ColTitle: "Total", ColType: "Money" },
    ],
  },
  Rows: {
    Row: [
      cd("Amy's Bird Sanctuary", ["", 239, "", "", "", 239], "1"),
      cd("Cool Cars", [694, "", "", "", "", 694], "3"),
      { Summary: { ColData: [{ value: "TOTAL" }, { value: "694.00" }, { value: "239.00" }, { value: "" }, { value: "" }, { value: "" }, { value: "933.00" }] }, type: "Section", group: "GrandTotal" },
    ],
  },
};

export const companyInfo = { CompanyInfo: { CompanyName: "Sandbox Company_US_1", LegalName: "Sandbox Company_US_1", FiscalYearStartMonth: "January", Country: "US" } };

export const invoices = [
  { Id: "130", DocNumber: "1037", TxnDate: "2026-10-20", DueDate: "2026-11-19", TotalAmt: 362.07, Balance: 362.07, CustomerRef: { value: "24", name: "Sonnenschein Family Store" }, Line: [{ Amount: 362.07, DetailType: "SalesItemLineDetail", Description: "Rock Fountain", SalesItemLineDetail: { ItemRef: { value: "5", name: "Rock Fountain" }, Qty: 1, UnitPrice: 275 } }, { Amount: 362.07, DetailType: "SubTotalLineDetail" }] },
  { Id: "129", DocNumber: "1036", TxnDate: "2026-09-01", DueDate: "2026-10-01", TotalAmt: 1000, Balance: 400, CustomerRef: { value: "3", name: "Cool Cars" }, Line: [] },
  { Id: "128", DocNumber: "1035", TxnDate: "2026-08-01", TotalAmt: 239, Balance: 239, CustomerRef: { value: "1", name: "Amy's Bird Sanctuary" }, Line: [] },
  { Id: "127", DocNumber: "1034", TxnDate: "2026-07-01", DueDate: "2026-07-31", TotalAmt: 500, Balance: 0, CustomerRef: { value: "3", name: "Cool Cars" }, Line: [] },
  { DocNumber: "broken", TxnDate: "2026-07-01", TotalAmt: 1 },
];

export const payments = [
  { Id: "200", TxnDate: "2026-08-15", TotalAmt: 500, UnappliedAmt: 0, CustomerRef: { value: "3", name: "Cool Cars" }, Line: [{ Amount: 500, LinkedTxn: [{ TxnId: "127", TxnType: "Invoice" }] }] },
  { Id: "201", TxnDate: "2026-10-15", TotalAmt: 650, UnappliedAmt: 50, CustomerRef: { value: "3", name: "Cool Cars" }, Line: [{ Amount: 600, LinkedTxn: [{ TxnId: "129", TxnType: "Invoice" }] }] },
];

export const bills = [
  { Id: "300", DocNumber: "B1", TxnDate: "2026-10-25", DueDate: "2026-11-24", TotalAmt: 1602.67, Balance: 1602.67, VendorRef: { value: "56", name: "Norton Lumber and Building Materials" }, Line: [{ Amount: 1602.67, DetailType: "AccountBasedExpenseLineDetail", AccountBasedExpenseLineDetail: { AccountRef: { value: "80", name: "Job Expenses:Job Materials" } } }] },
];

export const accounts = [
  { Id: "35", Name: "Checking", FullyQualifiedName: "Checking", AccountType: "Bank", AccountSubType: "Checking", Classification: "Asset", CurrentBalance: 1800, Active: true },
  { Id: "36", Name: "Savings", AccountType: "Bank", Classification: "Asset", CurrentBalance: 800, Active: true },
  { Id: "84", Name: "Accounts Receivable (A/R)", AccountType: "Accounts Receivable", Classification: "Asset", CurrentBalance: 5281.52, Active: true },
];

export const customers = [
  { Id: "1", DisplayName: "Amy's Bird Sanctuary", PrimaryEmailAddr: { Address: "Birds@Intuit.com" }, Balance: 239, Active: true },
  { Id: "3", DisplayName: "Cool Cars", Balance: 694, Active: true },
  { Id: "24", DisplayName: "Sonnenschein Family Store", Balance: 362.07, Active: true },
];

export const fault401 = { Fault: { Error: [{ Message: "message=AuthenticationFailed; errorCode=003200; statusCode=401", Detail: "Token expired", code: "3200" }], type: "AUTHENTICATION" }, time: "2026-11-18T10:00:00.000-08:00" };
export const fault400 = { Fault: { Error: [{ Message: "Invalid query", Detail: "QueryParserError: Encountered unexpected token", code: "4000" }], type: "ValidationFault" } };
