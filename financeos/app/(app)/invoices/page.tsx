import { InvoiceAssistant } from "@/components/finance/invoice-assistant";
import { NoData } from "@/components/finance/no-data";
import { PageHeader } from "@/components/finance/page-header";
import { SourceBadge } from "@/components/layout/source-badge";
import { customerTerms } from "@/lib/finance/invoice-draft";
import { loadWorkspace } from "@/lib/server/workspace";

export const metadata = { title: "Invoice Assistant" };

export default async function InvoicesPage() {
  const ws = await loadWorkspace();
  const ds = ws.dataset;
  if (!ds) {
    return (
      <>
        <PageHeader title="Invoice Assistant" />
        <NoData status={ws.status} />
      </>
    );
  }
  const terms = customerTerms(ds.invoices);
  const customers = ds.customers.filter((c) => c.active).map((c) => ({ id: c.id, name: c.name, termsDays: terms.get(c.id) ?? null })).sort((a, b) => a.name.localeCompare(b.name));
  return (
    <>
      <PageHeader
        title="Invoice Assistant"
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <SourceBadge source={ds.source} /> Describe an invoice in plain English and get an editable draft. Drafts stay on this computer; nothing is created or sent in QuickBooks.
          </span>
        }
      />
      <InvoiceAssistant customers={customers} today={ds.asOfDate} companyName={ds.company.name} />
    </>
  );
}
