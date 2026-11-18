import { NextResponse } from "next/server";
import { DATA_SOURCE_LABELS, type FinancialDataset } from "@/lib/domain/types";
import { formatIsoDate } from "@/lib/domain/dates";
import { csvFilename, toCsv, type CsvCell } from "@/lib/csv";
import { AGING_BUCKETS } from "@/lib/finance/aging";
import { applyArFilters, parseArFilters } from "@/lib/finance/ar-filters";
import { receivablesSnapshot } from "@/lib/finance/metrics";
import { parsePeriodKey, periodContaining } from "@/lib/finance/periods";
import {
  buildAgingTable,
  buildBalanceSheetTable,
  buildCashFlowTable,
  buildPnlTable,
  ratiosTable,
  type ComparisonMode,
  type StatementTable,
} from "@/lib/finance/report-tables";
import { buildManagementSummary, managementSummaryToText } from "@/lib/finance/summary";
import { getRequestContext, requirePermission } from "@/lib/server/context";
import { jsonError } from "@/lib/server/http";
import { forecastKey, loadSavedAssumptions } from "@/lib/server/forecast-store";
import { activeDataset } from "@/lib/server/workspace";

const REPORTS = ["receivables", "ar-aging", "pnl", "balance-sheet", "cash-flow", "ratios", "management-summary"] as const;
type Report = (typeof REPORTS)[number];

function preamble(ds: FinancialDataset, title: string): string[] {
  return [
    `${ds.company.name} - ${title}`,
    `Data source: ${DATA_SOURCE_LABELS[ds.source]}${ds.source === "demo" ? " (FICTIONAL DEMONSTRATION DATA)" : ""}`,
    `Reporting date: ${formatIsoDate(ds.asOfDate, "long")}`,
    "",
  ];
}

function statementCsv(ds: FinancialDataset, t: StatementTable): string {
  const header = ["Line", t.currentLabel, ...(t.comparisonLabel ? [t.comparisonLabel, "Change", "Change %"] : [])];
  const rows: CsvCell[][] = t.rows.map((r) => [
    `${"  ".repeat(r.depth)}${r.label}`,
    r.current,
    ...(t.comparisonLabel ? [r.comparison, r.change, r.changePct == null ? null : Math.round(r.changePct * 10000) / 100] : []),
  ]);
  for (const n of t.notes) rows.push([`Note: ${n}`]);
  return toCsv(header, rows, preamble(ds, t.title));
}

function csvResponse(body: string, filename: string, type = "text/csv; charset=utf-8") {
  return new NextResponse(body, {
    headers: {
      "Content-Type": type,
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

export async function GET(request: Request, ctx: { params: Promise<{ report: string }> }) {
  requirePermission(getRequestContext(), "view:financials");
  const { report } = await ctx.params;
  if (!REPORTS.includes(report as Report)) return jsonError(404, "Unknown report.");
  const { dataset: ds } = await activeDataset();
  if (!ds) return jsonError(409, "No data is available for the selected data source.");
  const url = new URL(request.url);
  const prefix = ds.source === "demo" ? "demo" : "qbo-sandbox";
  const compareParam = url.searchParams.get("compare");
  const compare: ComparisonMode = compareParam === "prior-year" || compareParam === "none" ? compareParam : "prior-period";
  const period = parsePeriodKey(url.searchParams.get("period") ?? "") ?? periodContaining(ds.asOfDate.slice(0, 7), "month", ds.company.fiscalYearStartMonth);

  switch (report as Report) {
    case "receivables": {
      const ar = receivablesSnapshot(ds);
      if (!ar) return jsonError(409, "Invoice data is not available.");
      const rows = applyArFilters(ar.open, parseArFilters(url.searchParams));
      const header = ["Invoice number", "Customer", "Invoice date", "Due date", "Days overdue", "Aging bucket", "Original amount", "Amount paid", "Outstanding balance", "Payment status", "Due date missing"];
      const body = toCsv(
        header,
        rows.map((i) => [i.docNumber ?? i.id, i.customerName, i.txnDate, i.dueDate ?? "", Math.max(0, i.daysOverdue), AGING_BUCKETS.find((b) => b.key === i.bucket)!.label, i.totalAmount, i.amountPaid, i.balance, i.status === "partially-paid" ? "Partially paid" : "Unpaid", i.dueDateMissing ? "Yes" : "No"]),
        preamble(ds, "Unpaid Invoices"),
      );
      return csvResponse(body, csvFilename(`${prefix}-unpaid-invoices`, ds.asOfDate));
    }
    case "ar-aging": {
      const t = buildAgingTable(ds);
      if (!t) return jsonError(409, "Invoice data is not available.");
      const rows: CsvCell[][] = t.rows.map((r) => [r.customer, ...r.values, r.total]);
      rows.push(["Total", ...t.totals, t.grandTotal]);
      return csvResponse(toCsv(["Customer", ...t.columns, "Total"], rows, preamble(ds, "Accounts Receivable Aging Summary")), csvFilename(`${prefix}-ar-aging`, ds.asOfDate));
    }
    case "pnl": {
      const t = buildPnlTable(ds, period, compare);
      if (!t) return jsonError(409, "Profit and loss data is not available for that period.");
      return csvResponse(statementCsv(ds, t), csvFilename(`${prefix}-profit-and-loss-${period.label}`, ds.asOfDate));
    }
    case "balance-sheet": {
      const t = buildBalanceSheetTable(ds, period, compare);
      if (!t) return jsonError(409, "Balance sheet data is not available for that period.");
      return csvResponse(statementCsv(ds, t), csvFilename(`${prefix}-balance-sheet-${period.label}`, ds.asOfDate));
    }
    case "cash-flow": {
      const t = buildCashFlowTable(ds, period, compare);
      if (!t) return jsonError(409, "Cash flow data is not available for that period.");
      return csvResponse(statementCsv(ds, t), csvFilename(`${prefix}-cash-flow-${period.label}`, ds.asOfDate));
    }
    case "ratios": {
      const rows = ratiosTable(ds).map((r) => [r.name, r.value == null ? "Not available" : Math.round(r.value * 10000) / 10000, r.format, r.formula, r.unavailableReason ?? ""]);
      return csvResponse(toCsv(["Ratio", "Value", "Unit", "Formula", "Note"], rows, preamble(ds, "Financial Ratios")), csvFilename(`${prefix}-ratios`, ds.asOfDate));
    }
    case "management-summary": {
      const saved = await loadSavedAssumptions(forecastKey(ds));
      const text = managementSummaryToText(buildManagementSummary(ds, undefined, { forecastAssumptions: saved?.assumptions }));
      return csvResponse(text, `${prefix}-management-summary-${ds.asOfDate}.txt`, "text/plain; charset=utf-8");
    }
  }
}
