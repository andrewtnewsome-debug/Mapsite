"use client";

import { ArrowLeft, Download, FileLock2, Printer } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { brand } from "@/config/brand";
import { STATE_NAMES } from "@/data/businesses";
import { DEAL_TYPE_LABEL } from "@/data/taxonomy";
import { dealRef, margin, money, pct, shortDate, thousands } from "@/lib/format";
import { getBusiness, getDeal, ndaFor } from "@/lib/selectors";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { Button, LinkButton } from "@/components/ui/button";
import { Card, EmptyState } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";

const SECTIONS = [
  ["overview", "Company overview"],
  ["services", "Products & services"],
  ["financials", "Financial summary"],
  ["customers", "Customers"],
  ["operations", "Operations"],
  ["management", "Management & ownership"],
  ["growth", "Growth opportunities"],
  ["transaction", "Transaction overview"],
] as const;

export default function CimPage() {
  const { id } = useParams<{ id: string }>();
  const { data, currentUser, session } = useStore();
  const toast = useToast();
  const deal = getDeal(data, id);
  const business = getBusiness(data, deal?.businessId);

  if (!deal || !business) {
    return (
      <Card>
        <EmptyState title="Document not found" action={<LinkButton href="/deals" variant="outline">Back to the deal feed</LinkButton>} />
      </Card>
    );
  }

  const nda = session.role === "investor" ? ndaFor(data, deal.id, currentUser.id) : undefined;
  const allowed = !!nda || session.role === "admin" || (session.role === "owner" && business.ownerUserId === currentUser.id);

  if (!allowed) {
    return (
      <Card>
        <EmptyState
          icon={<FileLock2 />}
          title="The CIM is locked"
          body="The Confidential Information Memorandum is released after you sign the platform's standard NDA for this listing."
          action={
            <LinkButton href={`/deals/${deal.id}`}>
              Go to {dealRef(deal.id)} and sign the NDA
            </LinkButton>
          }
        />
      </Card>
    );
  }

  const { cim } = deal;
  const fin = cim.financials;
  const watermark =
    session.role === "investor" && nda
      ? `Prepared for ${nda.firmName} under NDA ${nda.id.toUpperCase()}`
      : session.role === "admin"
        ? `${brand.sponsor.short} staff review copy`
        : "Owner preview";
  const workforceTotal = cim.operations.workforce.reduce((n, w) => n + w.count, 0);

  return (
    <div className="space-y-4">
      <div className="no-print flex flex-wrap items-center justify-between gap-3">
        <Link href={`/deals/${deal.id}`} className="inline-flex items-center gap-1 text-[13px] text-slate-500 hover:text-slate-800">
          <ArrowLeft className="size-3.5" /> Back to {dealRef(deal.id)}
        </Link>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => window.print()}>
            <Printer /> Print
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              // TODO(documents): generate a watermarked PDF server-side and log the download.
              toast({ tone: "info", title: "PDF download is not available in the prototype", body: "Use Print to save a copy as PDF." })
            }
          >
            <Download /> Download PDF
          </Button>
        </div>
      </div>

      <div className="grid items-start gap-5 xl:grid-cols-[200px_minmax(0,1fr)]">
        <nav className="no-print hidden xl:sticky xl:top-20 xl:block">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Contents</div>
          <ol className="space-y-1 text-[13px]">
            {SECTIONS.map(([sid, label], i) => (
              <li key={sid}>
                <a href={`#${sid}`} className="flex gap-2 rounded px-1.5 py-1 text-slate-600 hover:bg-white hover:text-slate-900">
                  <span className="tabular-nums text-slate-400">{i + 1}.</span> {label}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <article className="print-page mx-auto w-full max-w-[880px] overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          {/* Cover */}
          <header className="relative bg-slate-900 px-8 py-8 text-white sm:px-10">
            <div className="flex items-center justify-between text-[11px] font-medium uppercase tracking-[0.14em] text-slate-400">
              <span>Confidential Information Memorandum</span>
              <span className="tabular-nums">{dealRef(deal.id)}</span>
            </div>
            <h1 className="mt-6 font-serif text-[32px] leading-tight">{deal.companyName}</h1>
            <p className="mt-1 text-[14px] text-slate-300">
              {business.industry} · {deal.city}, {STATE_NAMES[business.state]} · {DEAL_TYPE_LABEL[deal.dealType]}
            </p>
            <div className="mt-6 grid grid-cols-2 gap-4 border-t border-white/15 pt-4 sm:grid-cols-4">
              {[
                ["FY2025 revenue", money(deal.revenue)],
                ["Adj. EBITDA", money(deal.ebitda)],
                ["Adj. EBITDA margin", pct(margin(deal.ebitda, deal.revenue))],
                ["Founded", String(new Date().getFullYear() - business.yearsInBusiness)],
              ].map(([k, v]) => (
                <div key={k}>
                  <div className="text-[10.5px] uppercase tracking-wide text-slate-400">{k}</div>
                  <div className="text-[18px] font-semibold tabular-nums">{v}</div>
                </div>
              ))}
            </div>
            <p className="mt-6 text-[11.5px] text-slate-400">
              {watermark} · Distributed via {brand.name} · {shortDate(new Date().toISOString())}
            </p>
          </header>

          <div className="space-y-9 px-8 py-8 sm:px-10">
            <Section n={1} id="overview" title="Company overview">
              {cim.overview.map((p, i) => (
                <p key={i} className="text-[14px] leading-relaxed text-slate-700">
                  {p}
                </p>
              ))}
              <KeyValueTable
                rows={[
                  ["Legal entity", business.legalName],
                  ["Headquarters", `${deal.city}, ${STATE_NAMES[business.state]}`],
                  ["Years in business", String(business.yearsInBusiness)],
                  ["Employees", `${workforceTotal} (${business.employeeRange})`],
                  ["Ownership", business.ownershipNote],
                  ["Certification", `${brand.sponsor.short} MBE · ${business.certifyingCouncil} · No. ${business.certificationNumber} · Expires ${shortDate(business.certificationExpiry)}`],
                  ...(business.additionalCertifications.length ? [["Additional certifications", business.additionalCertifications.join(", ")] as [string, string]] : []),
                ]}
              />
            </Section>

            <Section n={2} id="services" title="Products & services">
              <DataTable
                head={[cim.servicesHeading, "Share of revenue", "Description"]}
                align={["left", "right", "left"]}
                rows={cim.services.map((s) => [s.name, `${s.share}%`, s.detail])}
              />
            </Section>

            <Section n={3} id="financials" title="Financial summary">
              <p className="text-[12px] text-slate-500">$ in thousands. Fiscal years ending December 31. Adjusted EBITDA reflects normalizing add-backs described below.</p>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[520px] text-[13px] tabular-nums">
                  <thead>
                    <tr className="border-b-2 border-slate-900 text-right text-[12px] font-semibold text-slate-900">
                      <th className="py-2 text-left font-semibold">Income statement summary</th>
                      {fin.map((f) => (
                        <th key={f.year} className="py-2 pl-4">
                          {f.year}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <FinRow label="Revenue" values={fin.map((f) => thousands(f.revenue))} bold />
                    <FinRow
                      label="Growth"
                      values={fin.map((f, i) => (i === 0 ? "—" : pct(f.revenue / fin[i - 1].revenue - 1)))}
                      muted
                    />
                    <FinRow label="Gross profit" values={fin.map((f) => thousands(f.grossProfit))} />
                    <FinRow label="Gross margin" values={fin.map((f) => pct(f.grossProfit / f.revenue))} muted />
                    <FinRow label="Operating expenses" values={fin.map((f) => thousands(-f.operatingExpenses))} />
                    <FinRow label="Reported EBITDA" values={fin.map((f) => thousands(f.reportedEbitda))} topRule />
                    <FinRow label="Add-backs" values={fin.map((f) => thousands(f.addBacks))} />
                    <FinRow label="Adjusted EBITDA" values={fin.map((f) => thousands(f.adjustedEbitda))} bold topRule highlight />
                    <FinRow label="Adjusted EBITDA margin" values={fin.map((f) => pct(f.adjustedEbitda / f.revenue))} muted />
                    <FinRow label="Capital expenditures" values={fin.map((f) => thousands(-f.capex))} topRule />
                  </tbody>
                </table>
              </div>
              <ul className="list-disc space-y-1 pl-5 text-[13px] leading-relaxed text-slate-600">
                {cim.financialNotes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            </Section>

            <Section n={4} id="customers" title="Customers">
              <p className="text-[14px] leading-relaxed text-slate-700">{cim.customers.summary}</p>
              <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-slate-200 bg-slate-200 sm:grid-cols-4">
                {[
                  ["Active customers", cim.customers.activeCustomers.toLocaleString()],
                  ["Largest customer", `${cim.customers.topCustomerPct}% of revenue`],
                  ["Top 10 customers", `${cim.customers.topTenPct}% of revenue`],
                  ["Average tenure", `${cim.customers.avgTenureYears} years`],
                ].map(([k, v]) => (
                  <div key={k} className="bg-white px-4 py-3">
                    <div className="text-[10.5px] font-medium uppercase tracking-wide text-slate-500">{k}</div>
                    <div className="mt-0.5 text-[15px] font-semibold tabular-nums text-slate-900">{v}</div>
                  </div>
                ))}
              </div>
              <DataTable head={["Revenue by customer segment", "Share"]} align={["left", "right"]} rows={cim.customers.segments.map((s) => [s.name, `${s.pct}%`])} />
            </Section>

            <Section n={5} id="operations" title="Operations">
              <p className="text-[14px] leading-relaxed text-slate-700">{cim.operations.summary}</p>
              <DataTable
                head={["Facility", "Use", "Sq. ft.", "Tenure"]}
                align={["left", "left", "right", "left"]}
                rows={cim.operations.facilities.map((f) => [f.location, f.use, f.sqft.toLocaleString(), f.tenure])}
              />
              <div className="grid gap-5 md:grid-cols-2">
                <DataTable
                  head={["Workforce", "Headcount"]}
                  align={["left", "right"]}
                  rows={[...cim.operations.workforce.map((w) => [w.group, String(w.count)]), ["Total", String(workforceTotal)]]}
                  boldLast
                />
                <div className="space-y-3">
                  <ListBlock title="Systems" items={cim.operations.systems} />
                  <ListBlock title="Quality & compliance" items={cim.operations.quality} />
                </div>
              </div>
            </Section>

            <Section n={6} id="management" title="Management & ownership">
              <DataTable
                head={["Name", "Title", "Years", "Role"]}
                align={["left", "left", "right", "left"]}
                rows={cim.management.map((m) => [m.name, m.title, String(m.tenureYears), m.note])}
              />
              <p className="text-[13px] text-slate-600">
                <span className="font-medium text-slate-800">Ownership: </span>
                {business.ownershipNote}
              </p>
            </Section>

            <Section n={7} id="growth" title="Growth opportunities">
              <ol className="space-y-2">
                {cim.growth.map((g, i) => (
                  <li key={g} className="flex gap-3 text-[14px] leading-relaxed text-slate-700">
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[12px] font-semibold tabular-nums text-slate-700">
                      {i + 1}
                    </span>
                    {g}
                  </li>
                ))}
              </ol>
            </Section>

            <Section n={8} id="transaction" title="Transaction overview">
              <KeyValueTable
                rows={[
                  ["Transaction type", DEAL_TYPE_LABEL[deal.dealType]],
                  ["Owner objectives", deal.seeking],
                  ["Use of proceeds", cim.transaction.useOfProceeds],
                  ["Owner role after close", cim.transaction.ownerRole],
                  ["Valuation expectation", deal.askingValuation ? `${money(deal.askingValuation)} (${(deal.askingValuation / deal.ebitda).toFixed(1)}x FY2025 adj. EBITDA)` : "Not specified; open to proposals"],
                  ["Timing", cim.transaction.timing],
                ]}
              />
            </Section>

            <footer className="border-t border-slate-200 pt-4 text-[11.5px] leading-relaxed text-slate-500">
              This memorandum was prepared by the Company for the sole use of recipients bound by the {brand.name} standard NDA. It does not purport to be
              complete, has not been audited by {brand.operatorEntity}, and is not an offer to sell securities. Recipients should rely only on representations in a
              definitive agreement. All figures are illustrative sample data.
            </footer>
          </div>
        </article>
      </div>
    </div>
  );
}

function Section({ n, id, title, children }: { n: number; id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-20 space-y-3">
      <h2 className="flex items-baseline gap-2 border-b border-slate-200 pb-1.5 font-serif text-[20px] text-slate-900">
        <span className="text-[14px] tabular-nums text-brand">{n}.</span> {title}
      </h2>
      {children}
    </section>
  );
}

function KeyValueTable({ rows }: { rows: [string, string][] }) {
  return (
    <table className="w-full text-[13px]">
      <tbody className="divide-y divide-slate-100">
        {rows.map(([k, v]) => (
          <tr key={k} className="align-top">
            <th className="w-48 py-2 pr-4 text-left font-medium text-slate-500">{k}</th>
            <td className="py-2 text-slate-800">{v}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function DataTable({
  head,
  rows,
  align,
  boldLast,
}: {
  head: string[];
  rows: string[][];
  align: ("left" | "right")[];
  boldLast?: boolean;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b border-slate-300 text-[11.5px] font-semibold uppercase tracking-wide text-slate-500">
            {head.map((h, i) => (
              <th key={h} className={cn("py-2 pr-3 last:pr-0", align[i] === "right" ? "text-right" : "text-left")}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((r, ri) => (
            <tr key={ri} className={cn("align-top", boldLast && ri === rows.length - 1 && "border-t border-slate-300 font-semibold")}>
              {r.map((c, i) => (
                <td key={i} className={cn("py-2 pr-3 text-slate-800 last:pr-0", align[i] === "right" ? "text-right tabular-nums" : "text-left", i === 0 && "font-medium")}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FinRow({
  label,
  values,
  bold,
  muted,
  topRule,
  highlight,
}: {
  label: string;
  values: string[];
  bold?: boolean;
  muted?: boolean;
  topRule?: boolean;
  highlight?: boolean;
}) {
  return (
    <tr className={cn(topRule && "border-t border-slate-300", highlight && "bg-brand/5")}>
      <td className={cn("py-1.5 pr-4", bold ? "font-semibold text-slate-900" : muted ? "pl-3 italic text-slate-500" : "text-slate-700")}>{label}</td>
      {values.map((v, i) => (
        <td key={i} className={cn("py-1.5 pl-4 text-right", bold ? "font-semibold text-slate-900" : muted ? "italic text-slate-500" : "text-slate-700")}>
          {v}
        </td>
      ))}
    </tr>
  );
}

function ListBlock({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <div className="text-[11.5px] font-semibold uppercase tracking-wide text-slate-500">{title}</div>
      <ul className="mt-1 space-y-0.5 text-[13px] text-slate-700">
        {items.map((i) => (
          <li key={i}>· {i}</li>
        ))}
      </ul>
    </div>
  );
}
