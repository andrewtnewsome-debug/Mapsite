"use client";

import { MapPin, Unlock } from "lucide-react";
import Link from "next/link";
import type { CriteriaMatch, DealRow } from "@/lib/deals";
import { dealRef, margin, money, pct, relativeTime } from "@/lib/format";
import { CertBadges, DealTypePill, MatchBadge, NdaPill } from "./badges";
import { SaveDealButton } from "./save-button";

export function DealCard({ row, signed, match }: { row: DealRow; signed: boolean; match?: CriteriaMatch }) {
  const { deal, business } = row;
  return (
    <Link
      href={`/deals/${deal.id}`}
      className="group block rounded-lg border border-slate-200 bg-white shadow-xs transition hover:border-slate-300 hover:shadow-md"
    >
      <div className="px-4 pt-3.5 pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 text-[11.5px] font-medium text-slate-500">
            <span className="tabular-nums">{dealRef(deal.id)}</span>
            <span className="mx-1.5 text-slate-300">·</span>
            {business.industry}
            <span className="mx-1.5 text-slate-300">·</span>
            <span className="inline-flex items-center gap-0.5">
              <MapPin className="size-3" />
              {signed ? `${deal.city}, ${business.state}` : `${business.region} · ${business.state}`}
            </span>
          </div>
          <div className="-mt-1 -mr-1.5 flex items-center gap-1">
            <SaveDealButton dealId={deal.id} />
          </div>
        </div>
        <h3 className="mt-1 text-[15px] font-semibold leading-snug text-slate-900 group-hover:text-brand">{deal.teaserTitle}</h3>
        {signed && (
          <p className="mt-1 inline-flex items-center gap-1 text-[13px] font-medium text-emerald-700">
            <Unlock className="size-3.5" /> {deal.companyName}
          </p>
        )}
        <p className="mt-1.5 line-clamp-2 text-[13px] leading-relaxed text-slate-600">{deal.teaserDescription}</p>
      </div>
      <dl className="grid grid-cols-3 border-y border-slate-100 bg-slate-50/60 sm:grid-cols-5">
        {[
          ["Revenue", money(deal.revenue)],
          ["EBITDA", money(deal.ebitda)],
          ["Margin", pct(margin(deal.ebitda, deal.revenue))],
          ["Employees", business.employeeRange],
          ["Years", String(business.yearsInBusiness)],
        ].map(([k, v], i) => (
          <div key={k} className={`px-4 py-2 ${i >= 3 ? "hidden sm:block" : ""}`}>
            <dt className="text-[10.5px] font-medium uppercase tracking-wide text-slate-500">{k}</dt>
            <dd className="text-sm font-semibold tabular-nums text-slate-900">{v}</dd>
          </div>
        ))}
      </dl>
      <div className="flex flex-wrap items-center gap-1.5 px-4 py-2.5">
        <DealTypePill type={deal.dealType} />
        <CertBadges business={business} />
        <MatchBadge match={match} />
        <span className="ml-auto flex items-center gap-2">
          <NdaPill signed={signed} />
          <span className="text-[11.5px] text-slate-400">Listed {relativeTime(deal.listedAt ?? deal.createdAt)}</span>
        </span>
      </div>
    </Link>
  );
}
