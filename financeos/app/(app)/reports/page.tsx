import Link from "next/link";
import { Download, FileText } from "lucide-react";
import { NoData } from "@/components/finance/no-data";
import { PageHeader } from "@/components/finance/page-header";
import { ReportControls } from "@/components/finance/report-controls";
import { StatementTableView } from "@/components/finance/statement-table";
import { SourceBadge } from "@/components/layout/source-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, Notice } from "@/components/ui/states";
import { Table, TableWrap, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { formatIsoDate } from "@/lib/domain/dates";
import { availablePeriods, parsePeriodKey, type PeriodGranularity } from "@/lib/finance/periods";
import { buildAgingTable, buildBalanceSheetTable, buildCashFlowTable, buildPnlTable, ratiosTable, type ComparisonMode } from "@/lib/finance/report-tables";
import { formatCurrency, formatRatio } from "@/lib/format";
import { loadWorkspace } from "@/lib/server/workspace";

export const metadata = { title: "Financial Reports" };

const REPORTS = ["pnl", "balance-sheet", "cash-flow", "ar-aging", "ratios"] as const;
type Report = (typeof REPORTS)[number];

export default async function ReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ws = await loadWorkspace();
  const ds = ws.dataset;
  if (!ds) {
    return (
      <>
        <PageHeader title="Financial Reports" />
        <NoData status={ws.status} />
      </>
    );
  }
  const sp = await searchParams;
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const report: Report = REPORTS.includes(str("report") as Report) ? (str("report") as Report) : "pnl";
  const g: PeriodGranularity = str("g") === "quarter" || str("g") === "year" ? (str("g") as PeriodGranularity) : "month";
  const compare: ComparisonMode = str("compare") === "prior-year" || str("compare") === "none" ? (str("compare") as ComparisonMode) : "prior-period";
  const fy = ds.company.fiscalYearStartMonth;
  const months = (report === "cash-flow" ? ds.monthlyCashFlow : report === "balance-sheet" ? ds.balanceSheets.map((b) => ({ month: b.date.slice(0, 7) })) : ds.monthlyPnl).map((m) => m.month);
  const periods = availablePeriods(months, g, fy);
  // Default to the most recent complete period; in-progress periods remain selectable.
  const lastClosed = ds.monthlyPnl.filter((m) => !m.isPartial).at(-1)?.month;
  const requested = parsePeriodKey(str("period") ?? "");
  const period =
    (requested && periods.find((p) => p.key === requested.key)) ||
    (lastClosed ? periods.find((p) => p.endMonth <= lastClosed) : undefined) ||
    periods[0];

  const table =
    period && report === "pnl"
      ? buildPnlTable(ds, period, compare)
      : period && report === "balance-sheet"
        ? buildBalanceSheetTable(ds, period, compare)
        : period && report === "cash-flow"
          ? buildCashFlowTable(ds, period, compare)
          : null;
  const exportQuery = period ? `?period=${encodeURIComponent(period.key)}&compare=${compare}` : "";
  const exportHref = report === "ratios" ? "/api/export/ratios" : report === "ar-aging" ? "/api/export/ar-aging" : `/api/export/${report}${exportQuery}`;

  return (
    <>
      <PageHeader
        title="Financial Reports"
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <SourceBadge source={ds.source} /> Statements built from {ds.source === "demo" ? "the fictional demo ledger" : "QuickBooks Sandbox reports"}. Reporting date {formatIsoDate(ds.asOfDate, "long")}.
          </span>
        }
        actions={
          <>
            <Button asChild>
              <a href={exportHref} download>
                <Download /> Export CSV
              </a>
            </Button>
            <Button asChild variant="primary">
              <Link href="/reports/summary">
                <FileText /> Management summary
              </Link>
            </Button>
          </>
        }
      />
      <div className="no-print mb-4">
        <ReportControls report={report} granularity={g} periodKey={period?.key ?? ""} compare={compare} periods={periods} showPeriod={report === "pnl" || report === "balance-sheet" || report === "cash-flow"} />
      </div>

      {report === "ar-aging" ? (
        <AgingReport ds={ds} />
      ) : report === "ratios" ? (
        <RatiosReport ds={ds} />
      ) : !period || !table ? (
        <Card>
          <EmptyState title="No data for this report and period" description="Choose another period or data source." />
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <div>
              <CardTitle>{table.title}</CardTitle>
              <CardDescription>
                {ds.company.name} · {table.currentLabel}
                {table.comparisonLabel ? ` compared with ${table.comparisonLabel}` : ""}
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="px-0">
            {table.notes.length ? (
              <div className="px-5 pb-3">
                {table.notes.map((n) => (
                  <Notice key={n} tone="info" className="mb-2">{n}</Notice>
                ))}
              </div>
            ) : null}
            <StatementTableView table={table} />
          </CardContent>
        </Card>
      )}
    </>
  );
}

function AgingReport({ ds }: { ds: NonNullable<Awaited<ReturnType<typeof loadWorkspace>>["dataset"]> }) {
  const t = buildAgingTable(ds);
  if (!t) return <Card><EmptyState title="Invoice data is not available" /></Card>;
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Accounts Receivable Aging Summary</CardTitle>
          <CardDescription>As of {formatIsoDate(t.asOfDate, "long")} · days past due date</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="px-0">
        <TableWrap>
          <Table>
            <THead>
              <TR className="hover:bg-transparent">
                <TH>Customer</TH>
                {t.columns.map((c) => (
                  <TH key={c} numeric>{c.replace(" overdue", "")}</TH>
                ))}
                <TH numeric>Total</TH>
              </TR>
            </THead>
            <TBody>
              {t.rows.map((r) => (
                <TR key={r.customer}>
                  <TD className="font-medium">{r.customer}</TD>
                  {r.values.map((v, i) => (
                    <TD key={i} numeric className={v === 0 ? "text-text-3" : ""}>{v === 0 ? "—" : formatCurrency(v, { cents: true })}</TD>
                  ))}
                  <TD numeric className="font-semibold">{formatCurrency(r.total, { cents: true })}</TD>
                </TR>
              ))}
              <TR className="bg-surface-2/60 hover:bg-surface-2/60">
                <TD className="font-semibold">Total</TD>
                {t.totals.map((v, i) => (
                  <TD key={i} numeric className="font-semibold">{formatCurrency(v, { cents: true })}</TD>
                ))}
                <TD numeric className="font-semibold">{formatCurrency(t.grandTotal, { cents: true })}</TD>
              </TR>
            </TBody>
          </Table>
        </TableWrap>
      </CardContent>
    </Card>
  );
}

function RatiosReport({ ds }: { ds: NonNullable<Awaited<ReturnType<typeof loadWorkspace>>["dataset"]> }) {
  const ratios = ratiosTable(ds);
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Financial ratios</CardTitle>
          <CardDescription>Balance sheet ratios use the latest balance sheet; income ratios use trailing closed months.</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="px-0">
        <TableWrap>
          <Table>
            <THead>
              <TR className="hover:bg-transparent">
                <TH>Ratio</TH>
                <TH numeric>Value</TH>
                <TH>Formula</TH>
                <TH>What it means</TH>
              </TR>
            </THead>
            <TBody>
              {ratios.map((r) => (
                <TR key={r.id}>
                  <TD className="whitespace-nowrap font-medium">{r.name}</TD>
                  <TD numeric className={r.value == null ? "text-text-3" : "font-semibold"} title={r.unavailableReason}>{formatRatio(r.value, r.format)}</TD>
                  <TD className="min-w-56 text-[12px] text-text-2">{r.formula}</TD>
                  <TD className="min-w-64 text-[12px] text-text-3">{r.value == null ? r.unavailableReason : r.explanation}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </TableWrap>
      </CardContent>
    </Card>
  );
}
