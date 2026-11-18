import { InsightCard } from "@/components/finance/insight-card";
import { NoData } from "@/components/finance/no-data";
import { PageHeader } from "@/components/finance/page-header";
import { SourceBadge } from "@/components/layout/source-badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/states";
import { generateInsights, insightAsOfLabel } from "@/lib/finance/insights";
import { loadWorkspace } from "@/lib/server/workspace";

export const metadata = { title: "Insights" };

export default async function InsightsPage() {
  const ws = await loadWorkspace();
  const ds = ws.dataset;
  if (!ds) {
    return (
      <>
        <PageHeader title="Insights" />
        <NoData status={ws.status} />
      </>
    );
  }
  const insights = generateInsights(ds);
  return (
    <>
      <PageHeader
        title="Insights"
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <SourceBadge source={ds.source} /> Observations triggered by fixed rules on your data. {insightAsOfLabel(ds)}
          </span>
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-2 text-[12px] text-text-2 md:grid-cols-4">
        {[
          ["Verified facts", "Figures read or calculated from the accounting data."],
          ["Mathematical forecast", "Results of the 13-week forecast formulas."],
          ["Assumptions", "Inputs that were assumed, with the rule used."],
          ["AI interpretation", "Optional plain-English explanation from your local model. Not a source of facts."],
        ].map(([t, d]) => (
          <div key={t} className="rounded-lg border border-border bg-surface px-3 py-2">
            <p className="font-medium text-text">{t}</p>
            <p className="text-text-3">{d}</p>
          </div>
        ))}
      </div>
      {insights.length === 0 ? (
        <Card>
          <EmptyState title="No insights triggered" description="None of the monitoring rules are triggered by the current data." />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {insights.map((i) => (
            <InsightCard key={i.id} insight={i} />
          ))}
        </div>
      )}
    </>
  );
}
