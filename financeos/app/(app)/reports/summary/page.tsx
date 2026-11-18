import Link from "next/link";
import { ArrowLeft, Download } from "lucide-react";
import { NoData } from "@/components/finance/no-data";
import { PageHeader } from "@/components/finance/page-header";
import { PrintButton } from "@/components/finance/print-button";
import { SeverityBadge } from "@/components/finance/status";
import { SourceBadge } from "@/components/layout/source-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatIsoDate } from "@/lib/domain/dates";
import { buildManagementSummary } from "@/lib/finance/summary";
import { formatTimestamp } from "@/lib/format";
import { forecastKey, loadSavedAssumptions } from "@/lib/server/forecast-store";
import { loadWorkspace } from "@/lib/server/workspace";
import { NarrativePanel } from "@/components/ai/narrative-panel";

export const metadata = { title: "Management Summary" };

export default async function SummaryPage() {
  const ws = await loadWorkspace();
  const ds = ws.dataset;
  if (!ds) {
    return (
      <>
        <PageHeader title="Management summary" />
        <NoData status={ws.status} />
      </>
    );
  }
  const saved = await loadSavedAssumptions(forecastKey(ds));
  const s = buildManagementSummary(ds, undefined, { forecastAssumptions: saved?.assumptions });
  return (
    <>
      <div className="no-print mb-4">
        <Link href="/reports" className="inline-flex items-center gap-1 text-[13px] text-text-3 hover:text-text">
          <ArrowLeft className="size-3.5" /> Financial Reports
        </Link>
      </div>
      <PageHeader
        title="Management summary"
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <SourceBadge source={ds.source} /> {s.companyName} · as of {formatIsoDate(s.asOfDate, "long")} · generated {formatTimestamp(s.generatedAt)}
          </span>
        }
        actions={
          <>
            <Button asChild>
              <a href="/api/export/management-summary" download>
                <Download /> Download text
              </a>
            </Button>
            <PrintButton />
          </>
        }
      />
      {ds.source === "demo" ? <p className="mb-4 text-[13px] font-medium text-warning-text">Fictional demonstration data. Not a real company.</p> : null}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {s.sections.map((section) => (
          <Card key={section.title} className="break-inside-avoid">
            <CardHeader>
              <CardTitle>{section.title}</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="divide-y divide-border text-[13px]">
                {section.items.map((i) => (
                  <div key={i.label} className="grid grid-cols-[1fr_auto] items-baseline gap-x-3 py-2 first:pt-0 last:pb-0">
                    <dt className="text-text-2">{i.label}</dt>
                    <dd className="tabular font-semibold">{i.value}</dd>
                    {i.note ? <dd className="col-span-2 mt-0.5 text-[12px] text-text-3">{i.note}</dd> : null}
                  </div>
                ))}
              </dl>
            </CardContent>
          </Card>
        ))}
        <Card className="break-inside-avoid">
          <CardHeader>
            <CardTitle>Notable changes</CardTitle>
          </CardHeader>
          <CardContent>
            {s.notableChanges.length === 0 ? (
              <p className="text-[13px] text-text-3">No changes met the reporting thresholds.</p>
            ) : (
              <ul className="space-y-2 text-[13px]">
                {s.notableChanges.map((i) => (
                  <li key={i.id} className="flex items-start justify-between gap-3">
                    <span>{i.title}</span>
                    <SeverityBadge severity={i.severity} />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
      <Card className="mt-4 break-inside-avoid">
        <CardHeader>
          <CardTitle>Key financial risks</CardTitle>
        </CardHeader>
        <CardContent>
          {s.risks.length === 0 ? (
            <p className="text-[13px] text-text-3">No risk thresholds were triggered.</p>
          ) : (
            <ul className="divide-y divide-border text-[13px]">
              {s.risks.map((i) => (
                <li key={i.id} className="py-2.5 first:pt-0">
                  <div className="flex items-start justify-between gap-3">
                    <p className="font-medium">{i.title}</p>
                    <SeverityBadge severity={i.severity} />
                  </div>
                  <p className="mt-0.5 text-[12px] text-text-3">Rule: {i.trigger}</p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      <div className="mt-4">
        <NarrativePanel kind="management-summary" title="Plain-English commentary" />
      </div>
      <p className="mt-6 text-[12px] text-text-3">All figures are calculated deterministically by FinanceOS from the selected data source. Any AI commentary is generated locally from these figures and labeled as interpretation.</p>
    </>
  );
}
