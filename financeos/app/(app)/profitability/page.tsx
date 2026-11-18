import { MarginChart, RevenueExpensesChart, SignedBarChart } from "@/components/charts/charts";
import { Delta } from "@/components/finance/delta";
import { NoData } from "@/components/finance/no-data";
import { PageHeader } from "@/components/finance/page-header";
import { StatTile } from "@/components/finance/stat-tile";
import { SourceBadge } from "@/components/layout/source-badge";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, Notice } from "@/components/ui/states";
import { Table, TableWrap, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { formatIsoDate, monthLabel } from "@/lib/domain/dates";
import { EXPENSE_CHANGE_THRESHOLD, expenseChanges, lastClosedMonthComparison, trailingTwelveMonths } from "@/lib/finance/metrics";
import { invoicedByCustomer } from "@/lib/finance/revenue";
import { monthlyPnlSeries, PNL_CATEGORY_LABELS } from "@/lib/finance/statements";
import { formatCurrency, formatPercent, formatSignedPercent } from "@/lib/format";
import { loadWorkspace } from "@/lib/server/workspace";

export const metadata = { title: "Profitability" };

export default async function ProfitabilityPage() {
  const ws = await loadWorkspace();
  const ds = ws.dataset;
  if (!ds) {
    return (
      <>
        <PageHeader title="Profitability" />
        <NoData status={ws.status} />
      </>
    );
  }
  const month = lastClosedMonthComparison(ds);
  const ttm = trailingTwelveMonths(ds);
  const series = monthlyPnlSeries(ds).filter((m) => !m.isPartial);
  const last12 = series.slice(-12);
  const exp = expenseChanges(ds);
  const customers = invoicedByCustomer(ds);
  if (!month || !ttm) {
    return (
      <>
        <PageHeader title="Profitability" />
        <Card>
          <EmptyState title="Profit and loss data is not available" description="At least one closed month of profit and loss data is needed." />
        </Card>
      </>
    );
  }
  const name = monthLabel(month.month, "long");
  const p = month.prior;

  return (
    <>
      <PageHeader
        title="Profitability"
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <SourceBadge source={ds.source} /> Accounting profit (accrual basis). {name} is the last closed month; the current month is excluded until it ends.
          </span>
        }
      />
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label={`Revenue, ${name}`} value={formatCurrency(month.current.revenue)} delta={<Delta value={month.revenueChange} suffix="vs prior month" />} />
        <StatTile
          label="Gross profit"
          value={formatCurrency(month.current.grossProfit)}
          caption={`Margin ${formatPercent(month.current.grossMargin)}${p ? ` (prior ${formatPercent(p.grossMargin)})` : ""}`}
        />
        <StatTile label="Operating income" value={formatCurrency(month.current.operatingIncome)} caption={`Margin ${formatPercent(month.current.operatingMargin)}`} />
        <StatTile label={`Net income, ${name}`} value={formatCurrency(month.current.netIncome)} delta={<Delta value={month.netIncomeChange} suffix="vs prior month" />} caption={`Margin ${formatPercent(month.current.netMargin)}`} />
        <StatTile label={`Revenue, last ${ttm.monthCount} months`} value={formatCurrency(ttm.revenue)} />
        <StatTile label="Gross margin (trailing)" value={formatPercent(ttm.grossMargin)} />
        <StatTile label={`Net income, last ${ttm.monthCount} months`} value={formatCurrency(ttm.netIncome)} />
        <StatTile label="Net margin (trailing)" value={formatPercent(ttm.netMargin)} />
      </section>

      <section className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Revenue and expenses</CardTitle>
              <CardDescription>Monthly, last {last12.length} closed months</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <RevenueExpensesChart data={last12} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Net income by month</CardTitle>
              <CardDescription>Accounting profit, not cash</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <SignedBarChart seriesLabel="Net income" data={series.slice(-18).map((m) => ({ label: m.label, value: m.netIncome }))} height={286} />
          </CardContent>
        </Card>
      </section>

      <section className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-5">
        <Card className="xl:col-span-3">
          <CardHeader>
            <div>
              <CardTitle>Expense changes, {name}</CardTitle>
              <CardDescription>
                Flagged when up at least {formatPercent(EXPENSE_CHANGE_THRESHOLD.pct, 0)} and {formatCurrency(EXPENSE_CHANGE_THRESHOLD.amount)} versus both the prior month and the prior three-month average.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="px-0 pb-2">
            {exp ? (
              <TableWrap>
                <Table>
                  <THead>
                    <TR className="hover:bg-transparent">
                      <TH>Account</TH>
                      <TH numeric>{monthLabel(exp.month)}</TH>
                      <TH numeric>{monthLabel(exp.priorMonth)}</TH>
                      <TH numeric>Change</TH>
                      <TH numeric>vs 3-mo avg</TH>
                      <TH> </TH>
                    </TR>
                  </THead>
                  <TBody>
                    {exp.changes.map((c) => (
                      <TR key={`${c.category}-${c.account}`}>
                        <TD>
                          <span className="font-medium">{c.account}</span>
                          <span className="ml-2 text-[12px] text-text-3">{PNL_CATEGORY_LABELS[c.category]}</span>
                        </TD>
                        <TD numeric>{formatCurrency(c.lastMonth)}</TD>
                        <TD numeric className="text-text-2">{formatCurrency(c.priorMonth)}</TD>
                        <TD numeric className={c.changeVsPrior > 0 ? "text-text" : "text-text-2"}>
                          {formatCurrency(c.changeVsPrior)} <span className="text-text-3">({formatSignedPercent(c.pctVsPrior)})</span>
                        </TD>
                        <TD numeric className="text-text-2">{formatSignedPercent(c.pctVsBaseline)}</TD>
                        <TD>{c.significant ? <Badge tone="warning">Significant increase</Badge> : null}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </TableWrap>
            ) : (
              <EmptyState title="Two closed months are needed to compare expenses" />
            )}
            <p className="px-5 pt-2 text-[12px] text-text-3">These are changes in recorded amounts. FinanceOS does not infer why an expense changed; review the underlying transactions.</p>
          </CardContent>
        </Card>
        <Card className="xl:col-span-2">
          <CardHeader>
            <div>
              <CardTitle>Revenue concentration</CardTitle>
              <CardDescription>{customers ? `Invoiced since ${formatIsoDate(customers.since)}, by customer` : "Invoice data not available"}</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="px-0 pb-2">
            {customers && customers.customers.length ? (
              <TableWrap>
                <Table>
                  <THead>
                    <TR className="hover:bg-transparent">
                      <TH>Customer</TH>
                      <TH numeric>Invoiced</TH>
                      <TH numeric>Share</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {customers.customers.slice(0, 10).map((c) => (
                      <TR key={c.customerId}>
                        <TD className="max-w-48 truncate font-medium">{c.customerName}</TD>
                        <TD numeric>{formatCurrency(c.invoiced)}</TD>
                        <TD numeric className="text-text-2">{formatPercent(c.share)}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </TableWrap>
            ) : (
              <EmptyState title="Not available" />
            )}
            <p className="px-5 pt-2 text-[12px] text-text-3">Invoice totals before credits; may differ slightly from reported revenue.</p>
          </CardContent>
        </Card>
      </section>

      <Card className="mt-4">
        <CardHeader>
          <div>
            <CardTitle>Margin trend</CardTitle>
            <CardDescription>Gross and net margin by month</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <MarginChart data={series.slice(-18).map((m) => ({ label: m.label, grossMargin: m.grossMargin, netMargin: m.netMargin }))} />
          {ds.monthlyPnl.some((m) => m.isPartial) ? <Notice className="mt-3">The current month is in progress and is excluded from these charts.</Notice> : null}
        </CardContent>
      </Card>
    </>
  );
}
