"use client";

import { Check, ClipboardCheck, Eye, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import type { Deal, DealStatus } from "@/data/types";
import { getUser } from "@/data/users";
import { certHealth } from "@/lib/deals";
import { dealRef, money, pct, relativeTime, shortDate } from "@/lib/format";
import { getBusiness } from "@/lib/selectors";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { CertBadges, CertHealthPill, DealStatusPill, DealTypePill } from "@/components/deals/badges";
import { RoleGate } from "@/components/shell/role-gate";
import { Button, LinkButton } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Card, CardHeader, EmptyState, Field, PageHeader, Textarea } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";

const QUICK_REASONS = [
  "The public description mentions details that could identify the company. Please remove them.",
  "Please provide at least three specific, quantified investment highlights.",
  "The certification on file has expired. Upload a current certificate before the listing can go live.",
  "Please reconcile FY2025 revenue and EBITDA with the financial statements provided.",
];

const TABS: { id: "all" | DealStatus; label: string }[] = [
  { id: "all", label: "All" },
  { id: "live", label: "Live" },
  { id: "pending_review", label: "Pending" },
  { id: "changes_requested", label: "Changes requested" },
  { id: "draft", label: "Draft" },
  { id: "paused", label: "Paused" },
];

export default function AdminListingsPage() {
  return (
    <RoleGate allow={["admin"]}>
      <AdminListings />
    </RoleGate>
  );
}

function AdminListings() {
  const { data, approveDeal, requestChanges } = useStore();
  const toast = useToast();
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("all");
  const [changesFor, setChangesFor] = useState<Deal | null>(null);
  const [note, setNote] = useState("");

  const queue = data.deals.filter((d) => d.status === "pending_review").sort((a, b) => (a.submittedAt ?? "").localeCompare(b.submittedAt ?? ""));
  const all = data.deals.filter((d) => tab === "all" || d.status === tab);

  return (
    <>
      <PageHeader
        title="Listing review"
        description="Approve new listings for the deal feed or send them back to the owner with requested changes."
      />

      <Card className="mb-5">
        <CardHeader title="Review queue" description={queue.length ? `${queue.length} awaiting review · oldest first` : "No listings awaiting review"} />
        {queue.length === 0 ? (
          <EmptyState icon={<ClipboardCheck />} title="The review queue is clear" body="New submissions from business owners will appear here." />
        ) : (
          <ul className="divide-y divide-slate-100">
            {queue.map((deal) => {
              const biz = getBusiness(data, deal.businessId)!;
              const owner = getUser(biz.ownerUserId);
              const cert = certHealth(biz);
              const checks = [
                { label: "Certification current", pass: cert.status !== "expired" },
                { label: "Certification verified", pass: biz.verification === "verified" },
                { label: "Teaser omits name and city", pass: !deal.teaserDescription.includes(deal.city) && !deal.teaserDescription.includes(deal.companyName.split(" ")[0]) },
                { label: "Three or more highlights", pass: deal.highlights.length >= 3 },
                { label: "Financials provided", pass: deal.revenue > 0 && deal.ebitda > 0 },
              ];
              return (
                <li key={deal.id} className="grid gap-4 px-5 py-4 lg:grid-cols-[minmax(0,1fr)_260px_auto]">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2 text-[12px] text-slate-500">
                      <span className="tabular-nums">{dealRef(deal.id)}</span>·<span>{biz.industry}</span>·<span>{biz.state}</span>·
                      <span>Submitted {relativeTime(deal.submittedAt ?? deal.createdAt)}</span>
                    </div>
                    <div className="mt-1 text-[15px] font-semibold text-slate-900">{deal.companyName}</div>
                    <div className="text-[13px] text-slate-700">{deal.teaserTitle}</div>
                    <p className="mt-1 line-clamp-2 text-[12.5px] text-slate-500">{deal.teaserDescription}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[12.5px]">
                      <DealTypePill type={deal.dealType} />
                      <CertBadges business={biz} />
                      <span className="tabular-nums text-slate-600">
                        · Revenue {money(deal.revenue)} · Adj. EBITDA {money(deal.ebitda)} ({pct(deal.ebitda / deal.revenue)})
                      </span>
                    </div>
                    <div className="mt-1 text-[12px] text-slate-500">
                      Owner: {owner?.name}, {owner?.title} · {biz.certifyingCouncil} <CertHealthPill status={cert.status} />
                    </div>
                  </div>
                  <ul className="space-y-1 text-[12.5px]">
                    {checks.map((c) => (
                      <li key={c.label} className="flex items-center gap-1.5">
                        {c.pass ? <Check className="size-3.5 text-emerald-600" /> : <X className="size-3.5 text-red-500" />}
                        <span className={c.pass ? "text-slate-700" : "text-red-700"}>{c.label}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="flex flex-row flex-wrap items-start gap-2 lg:flex-col lg:items-stretch">
                    <LinkButton href={`/deals/${deal.id}`} variant="outline" size="sm">
                      <Eye /> Preview
                    </LinkButton>
                    <Button
                      size="sm"
                      disabled={cert.status === "expired"}
                      title={cert.status === "expired" ? "A current certificate is required before a listing can go live" : undefined}
                      onClick={() => {
                        approveDeal(deal.id);
                        toast({ title: `${dealRef(deal.id)} approved and published`, body: `${deal.companyName} is now live in the deal feed.` });
                      }}
                    >
                      <Check /> Approve &amp; publish
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setNote("");
                        setChangesFor(deal);
                      }}
                    >
                      Request changes
                    </Button>
                    {cert.status === "expired" && <p className="max-w-52 text-[11.5px] text-red-700">Approval blocked until a current certificate is on file.</p>}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader title="All listings" description={`${data.deals.length} listings on the platform`} />
        <div className="flex flex-wrap gap-1 border-b border-slate-200 px-4 py-2">
          {TABS.map((t) => {
            const count = t.id === "all" ? data.deals.length : data.deals.filter((d) => d.status === t.id).length;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={cn(
                  "rounded-md px-2.5 py-1 text-[12.5px] font-medium",
                  tab === t.id ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100",
                )}
              >
                {t.label} <span className="tabular-nums opacity-70">{count}</span>
              </button>
            );
          })}
        </div>
        {all.length === 0 ? (
          <EmptyState title="No listings in this status" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-[13px]">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-2.5">Company</th>
                  <th className="px-4 py-2.5">Status</th>
                  <th className="px-4 py-2.5">Deal type</th>
                  <th className="px-4 py-2.5 text-right">Revenue</th>
                  <th className="px-4 py-2.5 text-right">Adj. EBITDA</th>
                  <th className="px-4 py-2.5">Listed</th>
                  <th className="px-4 py-2.5">Certification</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {all.map((deal) => {
                  const biz = getBusiness(data, deal.businessId)!;
                  return (
                    <tr key={deal.id} className="hover:bg-slate-50/60">
                      <td className="px-4 py-2.5">
                        <Link href={`/deals/${deal.id}`} className="font-medium text-slate-900 hover:text-brand">
                          {deal.companyName}
                        </Link>
                        <div className="text-xs text-slate-500">
                          {dealRef(deal.id)} · {biz.industry} · {biz.state}
                        </div>
                        {deal.status === "changes_requested" && deal.reviewNote && (
                          <div className="mt-1 max-w-md text-xs text-red-700">“{deal.reviewNote}”</div>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        <DealStatusPill status={deal.status} />
                      </td>
                      <td className="px-4 py-2.5">
                        <DealTypePill type={deal.dealType} />
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{money(deal.revenue)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{money(deal.ebitda)}</td>
                      <td className="px-4 py-2.5 text-slate-600">{deal.listedAt ? shortDate(deal.listedAt) : "—"}</td>
                      <td className="px-4 py-2.5">
                        <CertHealthPill status={certHealth(biz).status} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Dialog
        open={!!changesFor}
        onClose={() => setChangesFor(null)}
        title={`Request changes · ${changesFor ? dealRef(changesFor.id) : ""}`}
        description="The owner sees this note on their listing and can resubmit after updating."
        footer={
          <>
            <Button variant="outline" onClick={() => setChangesFor(null)}>
              Cancel
            </Button>
            <Button
              disabled={note.trim().length < 10}
              onClick={() => {
                if (!changesFor) return;
                requestChanges(changesFor.id, note);
                toast({ title: "Changes requested", body: `${changesFor.companyName} has been returned to the owner.` });
                setChangesFor(null);
              }}
            >
              Send to owner
            </Button>
          </>
        }
      >
        <div className="space-y-3 px-5 py-4">
          <div>
            <div className="mb-1.5 text-[13px] font-medium text-slate-700">Common reasons</div>
            <div className="flex flex-col gap-1.5">
              {QUICK_REASONS.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setNote((n) => (n ? `${n} ${r}` : r))}
                  className="rounded-md border border-slate-200 px-3 py-1.5 text-left text-[12.5px] text-slate-700 hover:bg-slate-50"
                >
                  {r}
                </button>
              ))}
            </div>
          </div>
          <Field label="Note to owner" htmlFor="review-note" required>
            <Textarea id="review-note" data-autofocus rows={4} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>
      </Dialog>
    </>
  );
}
