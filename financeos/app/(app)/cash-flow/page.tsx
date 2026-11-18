import { CashHistoryChart, FlowsChart } from "@/components/charts/charts";
import { ForecastTool } from "@/components/finance/forecast-tool";
import { NoData } from "@/components/finance/no-data";
import { PageHeader } from "@/components/finance/page-header";
import { StatTile } from "@/components/finance/stat-tile";
import { SourceBadge } from "@/components/layout/source-badge";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, Notice } from "@/components/ui/states";
import { Table, TableWrap, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { addDays, formatIsoDate } from "@/lib/domain/dates";
import { deriveForecastDefaults, forecastDataWarnings } from "@/lib/finance/forecast";
import { forecastDataset } from "@/lib/finance/forecast-schema";
import { cashPosition, payablesSnapshot } from "@/lib/finance/metrics";
import { computeRatios, findRatio } from "@/lib/finance/ratios";
import { monthlyCashSeries, summarizeCashFlow } from "@/lib/finance/statements";
import { formatCurrency, formatRatio } from "@/lib/format";
import { forecastKey, loadSavedAssumptions } from "@/lib/server/forecast-store";
import { loadWorkspace } from "@/lib/server/workspace";

export const metadata = { title: "Cash Flow" };

export default async function CashFlowPage() {
  const ws = await loadWorkspace();
  const ds = ws.dataset;
  if (!ds) {
    return (
      <>
        <PageHeader title="Cash Flow" />
        <NoData status={ws.status} />
      </>
    );
  }
  const cash = cashPosition(ds);
  const series = monthlyCashSeries(ds);
  const closed = ds.monthlyCashFlow.filter((m) => !m.isPartial);
  const ttm = closed.length ? summarizeCashFlow(closed.slice(-12)) : null;
  const ap = payablesSnapshot(ds);
  const ratios = computeRatios(ds);
  const r = (id: string) => findRatio(ratios, id);
  const defaults = deriveForecastDefaults(ds);
  const saved = await loadSavedAssumptions(forecastKey(ds));
  const recent = series.slice(-7).reverse();
  const flows = series
    .filter((m) => !m.isPartial && m.collections != null && m.derivedOutflows != null)
    .slice(-12)
    .map((m) => ({ label: m.label, inflows: m.collections!, outflows: m.derivedOutflows!, net: m.netChange, note: "Cash out is derived: collections minus the net change in cash." }));

  return (
    <>
      <PageHeader
        title="Cash Flow"
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <SourceBadge source={ds.source} /> Historical figures come from the accounting records. The 13-week forecast below is a projection.
          </span>
        }
      />

      <div className="mb-3 flex items-center gap-2">
        <Badge tone="neutral">Historical</Badge>
        <p className="text-[13px] text-text-3">Recorded accounting figures through {formatIsoDate(ds.asOfDate, "long")}</p>
      </div>
      <section aria-label="Cash metrics" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Cash balance (book)" value={formatCurrency(cash?.amount)} caption={cash ? `As of ${formatIsoDate(cash.asOfDate)}` : undefined} info={cash?.caveat} />
        <StatTile label="Operating cash flow" value={formatCurrency(ttm?.operating)} caption={ttm ? `Last ${ttm.months.length} closed months` : undefined} info="Net income adjusted for non-cash items and working capital changes, per the cash flow statement." />
        <StatTile label="Investing cash flow" value={formatCurrency(ttm?.investing)} caption={ttm ? `Last ${ttm.months.length} closed months` : undefined} info="Capital purchases and asset sales." />
        <StatTile label="Financing cash flow" value={formatCurrency(ttm?.financing)} caption={ttm ? `Last ${ttm.months.length} closed months` : undefined} info="Loan proceeds and repayments, owner contributions and distributions." />
      </section>

      <section className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Monthly cash movement</CardTitle>
              <CardDescription>Customer collections (recorded payments) vs all other cash out (derived)</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            {flows.length ? <FlowsChart data={flows} inflowLabel="Customer collections" outflowLabel="Cash out (derived)" /> : <EmptyState title="Payment history is not available" description="Monthly inflows need customer payment records." />}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Ending cash by month</CardTitle>
              <CardDescription>Book cash per the balance sheet at each month end</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            {series.length ? <CashHistoryChart data={series.filter((m) => !m.isPartial).slice(-18).map((m) => ({ label: m.label, endingCash: m.endingCash }))} /> : <EmptyState title="Cash history is not available" />}
          </CardContent>
        </Card>
      </section>

      <section className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader>
            <div>
              <CardTitle>Cash flow by activity</CardTitle>
              <CardDescription>From the statement of cash flows (indirect method)</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="px-0 pb-2">
            {recent.length ? (
              <TableWrap aria-label="Cash flow by activity">
                <Table>
                  <THead>
                    <TR className="hover:bg-transparent">
                      <TH>Month</TH>
                      <TH numeric>Starting cash</TH>
                      <TH numeric>Operating</TH>
                      <TH numeric>Investing</TH>
                      <TH numeric>Financing</TH>
                      <TH numeric>Net change</TH>
                      <TH numeric>Ending cash</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {recent.map((m) => (
                      <TR key={m.month}>
                        <TD className="whitespace-nowrap font-medium">{m.label}</TD>
                        <TD numeric className="text-text-2">{formatCurrency(m.beginningCash)}</TD>
                        <TD numeric>{formatCurrency(m.operating)}</TD>
                        <TD numeric>{formatCurrency(m.investing)}</TD>
                        <TD numeric>{formatCurrency(m.financing)}</TD>
                        <TD numeric className={m.netChange < 0 ? "text-critical-text" : "text-good-text"}>{formatCurrency(m.netChange)}</TD>
                        <TD numeric className="font-semibold">{formatCurrency(m.endingCash)}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </TableWrap>
            ) : (
              <EmptyState title="Cash flow statement data is not available" />
            )}
            <p className="px-5 pt-2 text-[12px] text-text-3">Net income is accounting profit; the operating line converts it to cash by adding back non-cash costs and adjusting for changes in receivables and payables.</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Working capital</CardTitle>
              <CardDescription>Latest balance sheet</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <dl className="divide-y divide-border text-[13px]">
              {[
                ["Working capital", formatRatio(r("working-capital")?.value ?? null, "currency")],
                ["Current ratio", formatRatio(r("current-ratio")?.value ?? null, "ratio")],
                ["Quick ratio", formatRatio(r("quick-ratio")?.value ?? null, "ratio")],
                ["Days sales outstanding", formatRatio(r("dso")?.value ?? null, "days")],
                ["Days payables outstanding", formatRatio(r("dpo")?.value ?? null, "days")],
                ["Accounts payable", formatCurrency(ap?.total)],
                ["Bills due in next 30 days", formatCurrency(ap?.dueNext30Days)],
                ["Overdue bills", formatCurrency(ap?.overdue)],
              ].map(([k, v]) => (
                <div key={k} className="flex items-center justify-between gap-3 py-2">
                  <dt className="text-text-2">{k}</dt>
                  <dd className="tabular font-medium">{v}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>
      </section>

      <div className="mb-3 mt-10 flex flex-wrap items-center gap-2" id="forecast">
        <Badge tone="accent">Forecast</Badge>
        <h2 className="text-[17px] font-semibold tracking-tight">13-week cash flow forecast</h2>
        <p className="w-full text-[13px] text-text-3">
          Week 1 runs {formatIsoDate(addDays(ds.asOfDate, 1))} to {formatIsoDate(addDays(ds.asOfDate, 7))}. Collections use invoice due dates; vendor payments use bill due dates. Everything beyond recorded balances is an assumption you can change.
        </p>
      </div>
      {ds.source === "demo" ? <Notice className="mb-4">Demo company: the minimum cash balance and payroll register are fictional management inputs.</Notice> : null}
      <ForecastTool
        dataset={forecastDataset(ds)}
        defaults={defaults.assumptions}
        saved={saved}
        sources={defaults.sources}
        defaultWarnings={defaults.warnings}
        dataWarnings={forecastDataWarnings(ds)}
      />
    </>
  );
}
