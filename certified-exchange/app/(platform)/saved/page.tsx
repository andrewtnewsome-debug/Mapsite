"use client";

import { Bookmark, Search, Trash2 } from "lucide-react";
import Link from "next/link";
import { describeFilters, filterDeals } from "@/lib/deals";
import { dealRef, money, relativeTime, shortDate } from "@/lib/format";
import { dealRows, getBusiness, getDeal, ndaFor, profileByUser } from "@/lib/selectors";
import { useStore } from "@/lib/store";
import { DealStatusPill, DealTypePill, NdaPill } from "@/components/deals/badges";
import { SaveDealButton } from "@/components/deals/save-button";
import { RoleGate } from "@/components/shell/role-gate";
import { Button, LinkButton } from "@/components/ui/button";
import { Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";

export default function SavedPage() {
  return (
    <RoleGate allow={["investor"]}>
      <Saved />
    </RoleGate>
  );
}

function Saved() {
  const { data, currentUser, deleteSearch } = useStore();
  const toast = useToast();
  const saved = data.savedDeals.filter((s) => s.investorUserId === currentUser.id).sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  const searches = data.savedSearches.filter((s) => s.investorUserId === currentUser.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const live = dealRows(data, ["live"]);
  const profile = profileByUser(data, currentUser.id);

  return (
    <>
      <PageHeader title="Saved" description="Your deal watchlist and saved searches." actions={<LinkButton href="/deals" variant="outline">Go to deal feed</LinkButton>} />

      <Card className="mb-5">
        <CardHeader title="Watchlist" description={`${saved.length} saved ${saved.length === 1 ? "deal" : "deals"}`} />
        {saved.length === 0 ? (
          <EmptyState
            icon={<Bookmark />}
            title="Your watchlist is empty"
            body="Use the bookmark icon on any deal to keep track of it here. Owners see only an anonymous count of saves."
            action={<LinkButton href="/deals">Browse deals</LinkButton>}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-[13px]">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-2.5">Opportunity</th>
                  <th className="px-4 py-2.5">Deal type</th>
                  <th className="px-4 py-2.5 text-right">Revenue</th>
                  <th className="px-4 py-2.5 text-right">Adj. EBITDA</th>
                  <th className="px-4 py-2.5">Access</th>
                  <th className="px-4 py-2.5">Saved</th>
                  <th className="w-10 px-2 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {saved.map((s) => {
                  const deal = getDeal(data, s.dealId);
                  const biz = getBusiness(data, deal?.businessId);
                  if (!deal || !biz) return null;
                  const signed = !!ndaFor(data, deal.id, currentUser.id);
                  return (
                    <tr key={s.dealId} className="hover:bg-slate-50/60">
                      <td className="max-w-[420px] px-4 py-2.5">
                        <Link href={`/deals/${deal.id}`} className="font-medium leading-snug text-slate-900 hover:text-brand">
                          {deal.teaserTitle}
                        </Link>
                        <div className="text-xs text-slate-500">
                          {dealRef(deal.id)} · {biz.industry} · {signed ? `${deal.companyName}, ${deal.city}, ${biz.state}` : `${biz.region} · ${biz.state}`}
                        </div>
                        {deal.status !== "live" && (
                          <div className="mt-1">
                            <DealStatusPill status={deal.status} />
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        <DealTypePill type={deal.dealType} />
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{money(deal.revenue)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{money(deal.ebitda)}</td>
                      <td className="px-4 py-2.5">
                        <NdaPill signed={signed} />
                      </td>
                      <td className="px-4 py-2.5 text-slate-600">{shortDate(s.savedAt)}</td>
                      <td className="px-2 py-2">
                        <SaveDealButton dealId={deal.id} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <CardHeader title="Saved searches" description="Re-run a filter set against the live feed" />
        {searches.length === 0 ? (
          <EmptyState
            icon={<Search />}
            title="No saved searches"
            body="Apply filters in the deal feed and choose Save search to keep a named filter set here."
            action={<LinkButton href="/deals" variant="outline">Open the deal feed</LinkButton>}
          />
        ) : (
          <ul className="divide-y divide-slate-100">
            {searches.map((s) => {
              const matches = filterDeals(live, s.filters, profile).length;
              return (
                <li key={s.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[14px] font-medium text-slate-900">{s.name}</span>
                      <span className="rounded-full bg-brand/10 px-2 py-0.5 text-[11.5px] font-semibold tabular-nums text-brand">
                        {matches} {matches === 1 ? "match" : "matches"}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {describeFilters(s.filters).map((c) => (
                        <span key={c} className="rounded-full bg-slate-100 px-2 py-0.5 text-[12px] text-slate-600">
                          {c}
                        </span>
                      ))}
                    </div>
                    <div className="mt-1 text-[11.5px] text-slate-400">Saved {relativeTime(s.createdAt)}</div>
                  </div>
                  <LinkButton href={`/deals?search=${s.id}`} size="sm">
                    Run search
                  </LinkButton>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`Delete saved search ${s.name}`}
                    onClick={() => {
                      deleteSearch(s.id);
                      toast({ tone: "info", title: `Deleted “${s.name}”` });
                    }}
                  >
                    <Trash2 />
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </>
  );
}
