import Link from "next/link";
import { ArrowRight, MessageSquareText } from "lucide-react";
import { CashHistoryChart, RankedBars, RevenueExpensesChart } from "@/components/charts/charts";
import { Delta } from "@/components/finance/delta";
import { NoData } from "@/components/finance/no-data";
import { PageHeader } from "@/components/finance/page-header";
import { StatTile } from "@/components/finance/stat-tile";
import { HealthBadge, SeverityIcon } from "@/components/finance/status";
import { SourceBadge } from "@/components/layout/source-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/states";
import { formatIsoDate, monthLabel } from "@/lib/domain/dates";
import { generateInsights } from "@/lib/finance/insights";
import {
  cashPosition,
  healthIndicators,
  lastClosedMonthComparison,
  payablesSnapshot,
  receivablesSnapshot,
} from "@/lib/finance/metrics";
import { monthlyCashSeries, monthlyPnlSeries } from "@/lib/finance/statements";
import { formatCurrency, formatPercent, formatTimestamp, NOT_AVAILABLE } from "@/lib/format";
import { loadWorkspace } from "@/lib/server/workspace";

export default async function OverviewPage() {
  const ws = await loadWorkspace();
  const ds = ws.dataset;
  if (!ds) {
    return (
      <>
        <PageHeader title="Overview" />
        <NoData status={ws.status} />
      </>
    );
  }

  const cash = cashPosition(ds);
  const ar = receivablesSnapshot(ds);
  const ap = payablesSnapshot(ds);
  const month = lastClosedMonthComparison(ds);
  const health = healthIndicators(ds);
  const insights = generateInsights(ds).slice(0, 4);
  const cashSeries = monthlyCashSeries(ds).filter((m) => !m.isPartial).slice(-18).map((m) => ({ label: m.label, endingCash: m.endingCash }));
  const pnlSeries = monthlyPnlSeries(ds).filter((m) => !m.isPartial).slice(-12);
  const topOverdue = (ar?.customers ?? []).filter((c) => c.overdue > 0).sort((a, b) => b.overdue - a.overdue).slice(0, 5);
  const monthName = month ? monthLabel(month.month, "long") : "Last month";

  return (
    <>
      <PageHeader
        title="Overview"
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <SourceBadge source={ds.source} />
            <span>
              {ds.company.name} · reporting date {formatIsoDate(ds.asOfDate, "long")}
              {ds.source === "quickbooks-sandbox" ? ` · last successful sync ${formatTimestamp(ds.syncedAt)}` : " · fictional company for demonstration"}
            </span>
          </span>
        }
        actions={
          <Button asChild variant="primary">
            <Link href="/ai-cfo">
              <MessageSquareText /> Ask the AI CFO
            </Link>
          </Button>
        }
      />

      <section aria-label="Key metrics" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Cash balance"
          value={formatCurrency(cash?.amount)}
          caption={cash ? `Book balance, ${formatIsoDate(cash.asOfDate)}` : "No bank accounts found"}
          info={cash ? <>{cash.caveat} Accounts: {cash.accounts.map((a) => `${a.name} ${formatCurrency(a.balance)}`).join(", ")}.</> : "Not available from this data source."}
          href="/cash-flow"
        />
        <StatTile
          label="Accounts receivable"
          value={formatCurrency(ar?.aging.total)}
          caption={ar ? `${ar.aging.openInvoiceCount} open invoices` : undefined}
          info="Sum of unpaid invoice balances, including the unpaid part of partially paid invoices."
          href="/receivables"
        />
        <StatTile
          label="Overdue receivables"
          value={formatCurrency(ar?.aging.overdueAmount)}
          emphasis={ar && (ar.aging.overdueShareOfBalance ?? 0) > 0.25 ? "warning" : undefined}
          caption={ar ? `${formatPercent(ar.aging.overdueShareOfBalance)} of AR · ${formatCurrency(ar.aging.over60Amount)} over 60 days` : undefined}
          info="Open balance on invoices past their due date. Due today counts as current."
          href="/receivables"
        />
        <StatTile
          label="Accounts payable"
          value={formatCurrency(ap?.total)}
          caption={ap ? `${formatCurrency(ap.overdue)} overdue · ${formatCurrency(ap.dueNext30Days)} due in 30 days` : undefined}
          info="Sum of unpaid vendor bill balances."
          href="/cash-flow"
        />
        <StatTile
          label={`Revenue, ${monthName}`}
          value={formatCurrency(month?.current.revenue)}
          delta={month ? <Delta value={month.revenueChange} suffix="vs prior month" /> : undefined}
          info="Total income for the last fully closed month."
          href="/profitability"
        />
        <StatTile
          label={`Expenses, ${monthName}`}
          value={formatCurrency(month?.current.totalExpenses)}
          delta={month ? <Delta value={month.expenseChange} goodWhenUp={false} suffix="vs prior month" /> : undefined}
          info="Cost of goods sold, operating expenses and other expenses for the last closed month. Includes non-cash depreciation."
          href="/profitability"
        />
        <StatTile
          label={`Net income, ${monthName}`}
          value={formatCurrency(month?.current.netIncome)}
          delta={month ? <Delta value={month.netIncomeChange} suffix="vs prior month" /> : undefined}
          caption={month ? `Net margin ${formatPercent(month.current.netMargin)}` : undefined}
          info="Accounting profit. This is not the same as cash generated."
          href="/profitability"
        />
        <StatTile
          label="Overdue invoices"
          value={ar ? `${ar.aging.overdueCount} of ${ar.aging.openInvoiceCount}` : NOT_AVAILABLE}
          caption={ar ? `${formatPercent(ar.aging.overdueShareOfInvoices)} of open invoices` : undefined}
          href="/collections"
        />
      </section>

      <section className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-5">
        <Card className="xl:col-span-3">
          <CardHeader>
            <div>
              <CardTitle>Revenue and expenses</CardTitle>
              <CardDescription>Last {pnlSeries.length} closed months, accounting basis</CardDescription>
            </div>
          </CardHeader>
          <CardContent>{pnlSeries.length ? <RevenueExpensesChart data={pnlSeries} /> : <EmptyState title="Profit and loss data not available" />}</CardContent>
        </Card>
        <Card className="xl:col-span-2">
          <CardHeader>
            <div>
              <CardTitle>Historical cash balance</CardTitle>
              <CardDescription>Month-end book cash per the balance sheet</CardDescription>
            </div>
          </CardHeader>
          <CardContent>{cashSeries.length ? <CashHistoryChart data={cashSeries} /> : <EmptyState title="Cash history not available" />}</CardContent>
        </Card>
      </section>

      <section className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Largest overdue balances</CardTitle>
              <CardDescription>Customers ranked by past-due amount</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            {topOverdue.length ? (
              <RankedBars
                valueLabel="overdue balances"
                data={topOverdue.map((c) => ({ label: c.customerName, value: c.overdue, detail: `${c.overdueInvoiceCount} overdue invoice${c.overdueInvoiceCount === 1 ? "" : "s"}, oldest ${c.oldestDaysOverdue} days` }))}
              />
            ) : (
              <EmptyState title={ar ? "No overdue invoices" : "Invoice data not available"} />
            )}
            <Link href="/receivables" className="mt-4 inline-flex items-center gap-1 text-[13px] font-medium text-accent hover:underline">
              Open receivables <ArrowRight className="size-3.5" />
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Financial health</CardTitle>
              <CardDescription>Deterministic thresholds; hover for the rule</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-border">
              {health.map((h) => (
                <li key={h.id} className="flex items-start justify-between gap-3 py-2.5 first:pt-0 last:pb-0" title={h.rule}>
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium text-text">{h.name}</p>
                    <p className="text-[12px] text-text-3">{h.summary}</p>
                  </div>
                  <HealthBadge status={h.status} />
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>What to pay attention to</CardTitle>
              <CardDescription>Triggered by rules on your data</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            {insights.length ? (
              <ul className="space-y-3">
                {insights.map((i) => (
                  <li key={i.id} className="flex gap-2.5">
                    <SeverityIcon severity={i.severity} className="mt-0.5 size-4 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-[13px] font-medium leading-snug text-text">{i.title}</p>
                      <Link href={`/ai-cfo?q=${encodeURIComponent(i.followUpQuestion)}`} className="text-[12px] text-accent hover:underline">
                        Ask: {i.followUpQuestion}
                      </Link>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="No alerts triggered" />
            )}
            <Link href="/insights" className="mt-4 inline-flex items-center gap-1 text-[13px] font-medium text-accent hover:underline">
              All insights <ArrowRight className="size-3.5" />
            </Link>
          </CardContent>
        </Card>
      </section>
    </>
  );
}
