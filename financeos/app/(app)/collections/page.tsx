import { CollectionsWorkspace } from "@/components/finance/collections-workspace";
import { NoData } from "@/components/finance/no-data";
import { PageHeader } from "@/components/finance/page-header";
import { StatTile } from "@/components/finance/stat-tile";
import { SourceBadge } from "@/components/layout/source-badge";
import { formatIsoDate } from "@/lib/domain/dates";
import { buildCollectionPlans } from "@/lib/finance/collections";
import { receivablesSnapshot } from "@/lib/finance/metrics";
import { formatCurrency } from "@/lib/format";
import { loadWorkspace } from "@/lib/server/workspace";

export const metadata = { title: "Collections" };

export default async function CollectionsPage() {
  const ws = await loadWorkspace();
  const ds = ws.dataset;
  if (!ds) {
    return (
      <>
        <PageHeader title="Collections" />
        <NoData status={ws.status} />
      </>
    );
  }
  const plans = buildCollectionPlans(ds);
  const ar = receivablesSnapshot(ds);
  return (
    <>
      <PageHeader
        title="Collections"
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <SourceBadge source={ds.source} /> Who to contact, what to say, and a local follow-up list. Nothing is sent without you. As of {formatIsoDate(ds.asOfDate, "long")}.
          </span>
        }
      />
      <section className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Overdue balance" value={formatCurrency(ar?.aging.overdueAmount)} caption={ar ? `${ar.aging.overdueCount} invoices` : undefined} />
        <StatTile label="Customers overdue" value={String(plans.length)} />
        <StatTile label="High priority" value={String(plans.filter((p) => p.priority.level === "high").length)} />
        <StatTile label="Over 60 days" value={formatCurrency(ar?.aging.over60Amount)} emphasis={ar && ar.aging.over60Amount > 0 ? "critical" : undefined} />
      </section>
      <CollectionsWorkspace plans={plans} companyName={ds.company.name} asOfDate={ds.asOfDate} />
    </>
  );
}
