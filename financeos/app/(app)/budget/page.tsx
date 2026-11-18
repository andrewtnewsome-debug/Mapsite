import { BudgetPeriodPicker } from "@/components/finance/budget-period";
import { CreateBudget, EditBudget } from "@/components/finance/budget-controls";
import { NoData } from "@/components/finance/no-data";
import { PageHeader } from "@/components/finance/page-header";
import { StatTile } from "@/components/finance/stat-tile";
import { SourceBadge } from "@/components/layout/source-badge";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, Notice } from "@/components/ui/states";
import { Table, TableWrap, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { monthLabel } from "@/lib/domain/dates";
import { budgetVsActual, currentFiscalYear } from "@/lib/finance/budget";
import { periodContaining } from "@/lib/finance/periods";
import { PNL_CATEGORY_LABELS } from "@/lib/finance/statements";
import { formatCurrency, formatSignedPercent } from "@/lib/format";
import { loadBudget } from "@/lib/server/budget-store";
import { forecastKey } from "@/lib/server/forecast-store";
import { loadWorkspace } from "@/lib/server/workspace";

export const metadata = { title: "Budget vs Actual" };

export default async function BudgetPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ws = await loadWorkspace();
  const ds = ws.dataset;
  if (!ds) {
    return (
      <>
        <PageHeader title="Budget vs Actual" />
        <NoData status={ws.status} />
      </>
    );
  }
  const fy = currentFiscalYear(ds);
  const stored = await loadBudget(forecastKey(ds));
  const budget = stored && stored.startMonth === fy.startMonth ? stored : null;
  const closed = ds.monthlyPnl.filter((m) => !m.isPartial && fy.months.includes(m.month)).map((m) => m.month);
  const lastClosed = closed[closed.length - 1] ?? null;
  const sp = await searchParams;
  const view = sp.view === "month" || sp.view === "quarter" ? sp.view : "ytd";
  const months =
    !lastClosed ? [] : view === "month" ? [lastClosed] : view === "quarter" ? fy.months.filter((m) => { const q = periodContaining(lastClosed, "quarter", ds.company.fiscalYearStartMonth); return m >= q.startMonth && m <= q.endMonth; }) : fy.months.filter((m) => m <= lastClosed);
  const v = budget ? budgetVsActual(ds, budget, months) : null;
  const periodLabel = !lastClosed ? "" : view === "month" ? monthLabel(lastClosed, "long") : view === "quarter" ? `${periodContaining(lastClosed, "quarter", ds.company.fiscalYearStartMonth).label} (closed months)` : `${fy.label} year to date through ${monthLabel(lastClosed, "long")}`;
  const hasHistory = ds.monthlyPnl.some((m) => m.month < fy.startMonth);

  return (
    <>
      <PageHeader
        title="Budget vs Actual"
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <SourceBadge source={ds.source} /> Compare actual results with your {fy.label} budget. Only closed months are compared. The budget is stored on this computer.
          </span>
        }
        actions={budget ? <BudgetPeriodPicker view={view} /> : undefined}
      />
      {!budget ? (
        <>
          {stored ? <Notice tone="warning" className="mb-4">Your saved budget is for a different fiscal year. Draft a new one for {fy.label}.</Notice> : null}
          <CreateBudget fiscalYearLabel={fy.label} hasHistory={hasHistory} />
        </>
      ) : !v || v.actualMonths.length === 0 ? (
        <Card>
          <EmptyState title="No closed months yet in this fiscal year" description="Budget vs. actual appears once the first month of the fiscal year has closed." />
        </Card>
      ) : (
        <>
          <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile label="Revenue vs budget" value={formatCurrency(v.totals.revenueActual)} caption={`Budget ${formatCurrency(v.totals.revenueBudget)} · ${formatSignedPercent((v.totals.revenueActual - v.totals.revenueBudget) / Math.abs(v.totals.revenueBudget || 1))}`} />
            <StatTile label="Costs vs budget" value={formatCurrency(v.totals.costsActual)} caption={`Budget ${formatCurrency(v.totals.costsBudget)} · ${formatSignedPercent((v.totals.costsActual - v.totals.costsBudget) / Math.abs(v.totals.costsBudget || 1))}`} />
            <StatTile label="Net income vs budget" value={formatCurrency(v.totals.netIncomeActual)} caption={`Budget ${formatCurrency(v.totals.netIncomeBudget)}`} emphasis={v.totals.netIncomeActual < v.totals.netIncomeBudget ? "warning" : undefined} />
            <StatTile label="Net income variance" value={formatCurrency(v.totals.netIncomeActual - v.totals.netIncomeBudget)} caption={v.totals.netIncomeActual >= v.totals.netIncomeBudget ? "Ahead of budget" : "Behind budget"} />
          </section>
          <Card className="mt-4">
            <CardHeader>
              <div>
                <CardTitle>Variance by account</CardTitle>
                <CardDescription>{periodLabel}. Favorable means income above budget or costs below budget.</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="px-0 pb-2">
              <TableWrap aria-label="Budget variance by account">
                <Table>
                  <THead>
                    <TR className="hover:bg-transparent">
                      <TH>Account</TH>
                      <TH>Type</TH>
                      <TH numeric>Budget</TH>
                      <TH numeric>Actual</TH>
                      <TH numeric>Variance</TH>
                      <TH numeric>%</TH>
                      <TH>
                        <span className="sr-only">Assessment</span>
                      </TH>
                    </TR>
                  </THead>
                  <TBody>
                    {v.rows.map((r) => (
                      <TR key={`${r.category}|${r.account}`}>
                        <TD className="font-medium">{r.account}</TD>
                        <TD className="whitespace-nowrap text-[12px] text-text-3">{PNL_CATEGORY_LABELS[r.category]}</TD>
                        <TD numeric className="text-text-2">{formatCurrency(r.budget)}</TD>
                        <TD numeric>{formatCurrency(r.actual)}</TD>
                        <TD numeric className={r.favorable === false ? "font-medium text-critical-text" : r.favorable ? "text-good-text" : ""}>{formatCurrency(r.variance)}</TD>
                        <TD numeric className="text-text-3">{formatSignedPercent(r.variancePct)}</TD>
                        <TD>{r.favorable == null ? null : r.favorable ? <Badge tone="good">Favorable</Badge> : <Badge tone="warning">Unfavorable</Badge>}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </TableWrap>
            </CardContent>
          </Card>
          <div className="mt-4">
            <EditBudget budget={budget} />
          </div>
        </>
      )}
    </>
  );
}
