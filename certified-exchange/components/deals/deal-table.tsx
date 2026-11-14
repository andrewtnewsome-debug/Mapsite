"use client";

import { FileSignature, Lock } from "lucide-react";
import { useRouter } from "next/navigation";
import type { CriteriaMatch, DealRow } from "@/lib/deals";
import { dealRef, margin, money, pct } from "@/lib/format";
import { DealTypePill, MatchBadge } from "./badges";
import { SaveDealButton } from "./save-button";

export function DealTable({
  rows,
  signedIds,
  matches,
}: {
  rows: DealRow[];
  signedIds: Set<string>;
  matches: Map<string, CriteriaMatch | undefined>;
}) {
  const router = useRouter();
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-xs">
      <table className="w-full min-w-[920px] text-[13px]">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            <th className="px-3 py-2.5">Ref</th>
            <th className="px-3 py-2.5">Opportunity</th>
            <th className="px-3 py-2.5">Location</th>
            <th className="px-3 py-2.5">Deal type</th>
            <th className="px-3 py-2.5 text-right">Revenue</th>
            <th className="px-3 py-2.5 text-right">EBITDA</th>
            <th className="px-3 py-2.5 text-right">Margin</th>
            <th className="px-3 py-2.5 text-right">Years</th>
            <th className="px-3 py-2.5">Access</th>
            <th className="w-10 px-2 py-2.5" />
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map(({ deal, business }) => {
            const signed = signedIds.has(deal.id);
            return (
              <tr
                key={deal.id}
                onClick={() => router.push(`/deals/${deal.id}`)}
                className="cursor-pointer align-top hover:bg-slate-50"
              >
                <td className="px-3 py-2.5 tabular-nums text-slate-500">{dealRef(deal.id)}</td>
                <td className="max-w-[340px] px-3 py-2.5">
                  <div className="font-medium leading-snug text-slate-900">{deal.teaserTitle}</div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                    {business.industry}
                    {signed && <span className="font-medium text-emerald-700">· {deal.companyName}</span>}
                  </div>
                  <div className="mt-1">
                    <MatchBadge match={matches.get(deal.id)} />
                  </div>
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 text-slate-600">
                  {signed ? `${deal.city}, ${business.state}` : business.state}
                  <div className="text-xs text-slate-400">{business.region}</div>
                </td>
                <td className="px-3 py-2.5">
                  <DealTypePill type={deal.dealType} />
                </td>
                <td className="px-3 py-2.5 text-right font-medium tabular-nums">{money(deal.revenue)}</td>
                <td className="px-3 py-2.5 text-right font-medium tabular-nums">{money(deal.ebitda)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-slate-600">{pct(margin(deal.ebitda, deal.revenue))}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-slate-600">{business.yearsInBusiness}</td>
                <td className="whitespace-nowrap px-3 py-2.5">
                  {signed ? (
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
                      <FileSignature className="size-3.5" /> NDA signed
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-xs text-slate-500">
                      <Lock className="size-3.5" /> Teaser
                    </span>
                  )}
                </td>
                <td className="px-2 py-2" onClick={(e) => e.stopPropagation()}>
                  <SaveDealButton dealId={deal.id} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
