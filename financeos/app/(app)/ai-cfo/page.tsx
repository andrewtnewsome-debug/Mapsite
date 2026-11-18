import { AiCfoChat } from "@/components/ai/chat";
import { AiStatusCard } from "@/components/ai/ai-status-card";
import { NoData } from "@/components/finance/no-data";
import { PageHeader } from "@/components/finance/page-header";
import { SourceBadge } from "@/components/layout/source-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getOllamaStatus, modelThinkingMode } from "@/lib/ai/ollama";
import { SUPPORTED_QUESTIONS } from "@/lib/ai/router";
import { formatIsoDate } from "@/lib/domain/dates";
import { resolveOllamaConfig } from "@/lib/server/ai-config";
import { loadWorkspace } from "@/lib/server/workspace";

export const metadata = { title: "AI CFO" };

export default async function AiCfoPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ws = await loadWorkspace();
  const ds = ws.dataset;
  const { config, error } = await resolveOllamaConfig();
  const status = config ? await getOllamaStatus(config) : null;
  const thinkingMode = config && status?.modelInstalled ? await modelThinkingMode(config) : null;
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.slice(0, 1000) : undefined;

  return (
    <>
      <PageHeader
        title="AI CFO"
        description={
          ds ? (
            <span className="inline-flex flex-wrap items-center gap-2">
              <SourceBadge source={ds.source} /> Ask questions in plain English. Answers come from {ds.company.name}&apos;s data as of {formatIsoDate(ds.asOfDate, "long")}.
            </span>
          ) : undefined
        }
      />
      {!ds ? (
        <NoData status={ws.status} />
      ) : (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_300px]">
          <AiCfoChat suggestions={SUPPORTED_QUESTIONS.slice(0, 10)} initialQuestion={q} companyName={ds.company.name} asOfLabel={formatIsoDate(ds.asOfDate, "long")} />
          <aside aria-label="Local AI status and help" className="space-y-4 xl:sticky xl:top-20 xl:self-start">
            <AiStatusCard status={status} configError={error} thinkingMode={thinkingMode} />
            <Card>
              <CardHeader>
                <CardTitle>How answers work</CardTitle>
              </CardHeader>
              <CardContent>
                <ol className="list-decimal space-y-1.5 pl-4 text-[12px] leading-relaxed text-text-2">
                  <li>FinanceOS works out which figures your question needs.</li>
                  <li>It calculates them from your accounting data with fixed formulas.</li>
                  <li>Only those verified figures go to the local AI model, which writes the explanation.</li>
                  <li>Every number in the reply is checked against the calculations; anything that does not match is flagged.</li>
                </ol>
                <p className="mt-3 text-[12px] text-text-3">Open &quot;Verified data used&quot; under any answer to see the exact figures, dates, sources and assumptions.</p>
              </CardContent>
            </Card>
          </aside>
        </div>
      )}
    </>
  );
}
