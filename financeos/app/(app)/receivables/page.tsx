import Link from "next/link";
import { Download, Send } from "lucide-react";
import { AgingChart } from "@/components/charts/charts";
import { NoData } from "@/components/finance/no-data";
import { PageHeader } from "@/components/finance/page-header";
import { ReceivablesExplorer } from "@/components/finance/receivables-explorer";
import { StatTile } from "@/components/finance/stat-tile";
import { PriorityBadge } from "@/components/finance/status";
import { SourceBadge } from "@/components/layout/source-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, Notice } from "@/components/ui/states";
import { Table, TableWrap, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { formatIsoDate } from "@/lib/domain/dates";
import { AGING_BUCKETS } from "@/lib/finance/aging";
import { receivablesSnapshot } from "@/lib/finance/metrics";
import { computeRatios, findRatio } from "@/lib/finance/ratios";
import { formatCurrency, formatPercent, formatRatio } from "@/lib/format";
import { loadWorkspace } from "@/lib/server/workspace";

export const metadata = { title: "Accounts Receivable" };

export default async function ReceivablesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ws = await loadWorkspace();
  const ds = ws.dataset;
  if (!ds) {
    return (
      <>
        <PageHeader title="Accounts Receivable" />
        <NoData status={ws.status} />
      </>
    );
  }
  const sp = await searchParams;
  const bucketParam = typeof sp.bucket === "string" ? sp.bucket : undefined;
  const initialBucket = bucketParam && ["overdue", "current", "1-30", "31-60", "61-90", "90+"].includes(bucketParam) ? (bucketParam as "overdue") : undefined;
  const ar = receivablesSnapshot(ds);
  if (!ar) {
    return (
      <>
        <PageHeader title="Accounts Receivable" />
        <Card>
          <EmptyState title="Invoice data is not available" description="The selected data source did not provide invoices." />
        </Card>
      </>
    );
  }
  const dso = findRatio(computeRatios(ds), "dso");
  const agingData = AGING_BUCKETS.map((b) => ({ label: b.key === "current" ? "Current" : `${b.shortLabel} days`, amount: ar.aging.buckets[b.key].amount, count: ar.aging.buckets[b.key].count, share: ar.aging.buckets[b.key].share }));
  const recon = ds.sourceArAging;
  const reconDiff = recon?.total != null ? Math.round((ar.aging.total - recon.total) * 100) / 100 : null;

  return (
    <>
      <PageHeader
        title="Accounts Receivable"
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <SourceBadge source={ds.source} /> Aging as of {formatIsoDate(ds.asOfDate, "long")}. Days overdue are counted from each invoice&apos;s due date.
          </span>
        }
        actions={
          <>
            <Button asChild>
              <a href="/api/export/ar-aging" download>
                <Download /> Aging summary CSV
              </a>
            </Button>
            <Button asChild variant="primary">
              <Link href="/collections">
                <Send /> Collections
              </Link>
            </Button>
          </>
        }
      />

      <section aria-label="Receivables metrics" className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatTile label="Total receivables" value={formatCurrency(ar.aging.total)} caption={`${ar.aging.openInvoiceCount} open invoices`} />
        <StatTile label="Overdue" value={formatCurrency(ar.aging.overdueAmount)} caption={`${formatPercent(ar.aging.overdueShareOfBalance)} of balance`} emphasis={(ar.aging.overdueShareOfBalance ?? 0) > 0.25 ? "warning" : undefined} />
        <StatTile label="Over 60 days" value={formatCurrency(ar.aging.over60Amount)} caption={`${formatCurrency(ar.aging.over90Amount)} over 90 days`} emphasis={ar.aging.over90Amount > 0 ? "critical" : undefined} />
        <StatTile label="Invoices overdue" value={formatPercent(ar.aging.overdueShareOfInvoices)} caption={`${ar.aging.overdueCount} of ${ar.aging.openInvoiceCount} by count`} />
        <StatTile label="Days sales outstanding" value={formatRatio(dso?.value ?? null, "days")} info={dso?.formula} caption={ar.aging.partiallyPaidCount ? `${ar.aging.partiallyPaidCount} partially paid invoices` : undefined} />
      </section>

      {recon && reconDiff != null && Math.abs(reconDiff) >= 1 ? (
        <Notice tone="warning" className="mt-4" title="Our aging differs from the QuickBooks A/R Aging report">
          FinanceOS total {formatCurrency(ar.aging.total, { cents: true })} vs QuickBooks report {formatCurrency(recon.total, { cents: true })} (difference {formatCurrency(reconDiff, { cents: true })}). Differences usually come from unapplied credits or credit memos, which the report nets against customer balances.
        </Notice>
      ) : recon ? (
        <Notice className="mt-4">Reconciled: our aging total matches the QuickBooks A/R Aging report ({formatCurrency(recon.total, { cents: true })}).</Notice>
      ) : null}
      {ar.aging.missingDueDateCount > 0 ? (
        <Notice tone="warning" className="mt-4">{ar.aging.missingDueDateCount} open invoice(s) have no due date. Their invoice date is used for aging and they are marked with *.</Notice>
      ) : null}

      <section className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-5">
        <Card className="xl:col-span-3">
          <CardHeader>
            <div>
              <CardTitle>Aging distribution</CardTitle>
              <CardDescription>Outstanding balance by days past due</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <AgingChart data={agingData} />
          </CardContent>
        </Card>
        <Card className="xl:col-span-2">
          <CardHeader>
            <div>
              <CardTitle>Collections priority</CardTitle>
              <CardDescription>Ranked by overdue balance, age and share over 60 days</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="pt-2">
            {ar.priorities.length === 0 ? (
              <EmptyState title="No overdue customers" />
            ) : (
              <ol className="divide-y divide-border">
                {ar.priorities.slice(0, 7).map((p, idx) => (
                  <li key={p.customerId} className="flex items-start gap-3 py-2.5">
                    <span className="tabular mt-0.5 w-4 text-[12px] text-text-3">{idx + 1}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate text-[13px] font-medium">{p.customerName}</p>
                        <span className="tabular text-[13px] font-medium">{formatCurrency(p.overdue)}</span>
                      </div>
                      <div className="mt-0.5 flex items-center justify-between gap-2">
                        <p className="truncate text-[12px] text-text-3">{p.reasons.join(" · ")}</p>
                        <PriorityBadge level={p.level} score={p.score} />
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>
      </section>

      <Card className="mt-4">
        <CardHeader>
          <div>
            <CardTitle>Customer balances</CardTitle>
            <CardDescription>Open balance by customer and aging bucket</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="px-0 pb-2">
          <TableWrap>
            <Table>
              <THead>
                <TR className="hover:bg-transparent">
                  <TH>Customer</TH>
                  {AGING_BUCKETS.map((b) => (
                    <TH key={b.key} numeric>{b.key === "current" ? "Current" : b.shortLabel}</TH>
                  ))}
                  <TH numeric>Total</TH>
                  <TH numeric>Share</TH>
                </TR>
              </THead>
              <TBody>
                {ar.customers.map((c) => (
                  <TR key={c.customerId}>
                    <TD className="font-medium">{c.customerName}</TD>
                    {AGING_BUCKETS.map((b) => (
                      <TD key={b.key} numeric className={c.buckets[b.key] === 0 ? "text-text-3" : b.key === "61-90" || b.key === "90+" ? "font-medium text-critical-text" : ""}>
                        {c.buckets[b.key] === 0 ? "—" : formatCurrency(c.buckets[b.key])}
                      </TD>
                    ))}
                    <TD numeric className="font-semibold">{formatCurrency(c.total)}</TD>
                    <TD numeric className="text-text-2">{formatPercent(c.shareOfTotal)}</TD>
                  </TR>
                ))}
                <TR className="bg-surface-2/60 hover:bg-surface-2/60">
                  <TD className="font-semibold">Total</TD>
                  {AGING_BUCKETS.map((b) => (
                    <TD key={b.key} numeric className="font-semibold">{formatCurrency(ar.aging.buckets[b.key].amount)}</TD>
                  ))}
                  <TD numeric className="font-semibold">{formatCurrency(ar.aging.total)}</TD>
                  <TD numeric>100.0%</TD>
                </TR>
              </TBody>
            </Table>
          </TableWrap>
        </CardContent>
      </Card>

      <Card className="mt-4">
        <CardHeader>
          <div>
            <CardTitle>Unpaid invoices</CardTitle>
            <CardDescription>Filter by customer, aging, balance and due date. Partially paid invoices show the remaining balance.</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          <ReceivablesExplorer
            invoices={ar.open}
            initialBucket={initialBucket}
            customers={ar.customers.map((c) => ({ id: c.customerId, name: c.customerName })).sort((a, b) => a.name.localeCompare(b.name))}
          />
        </CardContent>
      </Card>
    </>
  );
}
