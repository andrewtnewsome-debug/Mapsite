"use client";

import {
  ArrowRight,
  BadgeCheck,
  CheckCircle2,
  ClipboardCheck,
  FileSignature,
  MessageSquare,
  Pause,
  Play,
  Send,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { brand } from "@/config/brand";
import type { ActivityKind } from "@/data/types";
import { getUser } from "@/data/users";
import { certHealth } from "@/lib/deals";
import { dealRef, money, relativeTime } from "@/lib/format";
import { getBusiness, getDeal } from "@/lib/selectors";
import { useStore } from "@/lib/store";
import { DealStatusPill } from "@/components/deals/badges";
import { RoleGate } from "@/components/shell/role-gate";
import { LinkButton } from "@/components/ui/button";
import { Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/primitives";

const ACTIVITY_ICON: Record<ActivityKind, React.ComponentType<{ className?: string }>> = {
  nda_signed: FileSignature,
  inquiry_sent: Send,
  message_sent: MessageSquare,
  listing_submitted: ClipboardCheck,
  listing_approved: CheckCircle2,
  changes_requested: XCircle,
  listing_paused: Pause,
  listing_resumed: Play,
  cert_verified: ShieldCheck,
  investor_verified: BadgeCheck,
  investor_unverified: BadgeCheck,
};

export default function AdminOverviewPage() {
  return (
    <RoleGate allow={["admin"]}>
      <AdminOverview />
    </RoleGate>
  );
}

function AdminOverview() {
  const { data } = useStore();
  const live = data.deals.filter((d) => d.status === "live");
  const pending = data.deals.filter((d) => d.status === "pending_review");
  const certAttention = data.businesses.filter((b) => certHealth(b).status !== "verified");
  const verifiedInvestors = data.investorProfiles.filter((p) => p.verified).length;
  const liveEbitda = live.reduce((n, d) => n + d.ebitda, 0);
  const activity = [...data.activity].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 14);

  const stats = [
    { label: "Live deals", value: live.length, sub: `${money(liveEbitda)} combined adj. EBITDA`, href: "/admin/listings" },
    { label: "Pending review", value: pending.length, sub: pending.length ? "Awaiting staff action" : "Queue is clear", href: "/admin/listings" },
    { label: "NDAs signed", value: data.ndas.length, sub: `${new Set(data.ndas.map((n) => n.investorUserId)).size} investors`, href: undefined },
    { label: "Inquiries sent", value: data.inquiries.length, sub: `${data.messages.length} messages exchanged`, href: undefined },
    { label: "Verified investors", value: `${verifiedInvestors}/${data.investorProfiles.length}`, sub: "Identity and capital confirmed", href: "/admin/investors" },
    { label: "Certifications", value: certAttention.length, sub: "Need attention", href: "/admin/certifications" },
  ];

  const engagement = data.deals
    .filter((d) => d.status === "live" || d.status === "paused")
    .map((d) => ({
      deal: d,
      biz: getBusiness(data, d.businessId)!,
      ndas: data.ndas.filter((n) => n.dealId === d.id).length,
      inquiries: data.inquiries.filter((i) => i.dealId === d.id).length,
      saves: data.savedDeals.filter((s) => s.dealId === d.id).length,
    }))
    .sort((a, b) => b.ndas - a.ndas || b.deal.teaserViews - a.deal.teaserViews);

  return (
    <>
      <PageHeader
        title="Platform overview"
        description={`Listing review, certification verification and marketplace activity for ${brand.name}.`}
        actions={
          pending.length > 0 && (
            <LinkButton href="/admin/listings">
              Review {pending.length} pending {pending.length === 1 ? "listing" : "listings"} <ArrowRight />
            </LinkButton>
          )
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {stats.map((s) => {
          const inner = (
            <Card className="h-full px-4 py-3.5 transition hover:border-slate-300">
              <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{s.label}</div>
              <div className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{s.value}</div>
              <div className="mt-0.5 text-[12px] text-slate-500">{s.sub}</div>
            </Card>
          );
          return s.href ? (
            <Link key={s.label} href={s.href}>
              {inner}
            </Link>
          ) : (
            <div key={s.label}>{inner}</div>
          );
        })}
      </div>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card className="min-w-0">
          <CardHeader title="Deal engagement" description="Live and paused listings ranked by NDAs signed" />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-[13px]">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  <th className="px-3 py-2.5">Listing</th>
                  <th className="px-3 py-2.5">Status</th>
                  <th className="px-3 py-2.5 text-right">Adj. EBITDA</th>
                  <th className="px-3 py-2.5 text-right">Views</th>
                  <th className="px-3 py-2.5 text-right">Saves</th>
                  <th className="px-3 py-2.5 text-right">NDAs</th>
                  <th className="px-3 py-2.5 text-right">Inquiries</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {engagement.map(({ deal, biz, ndas, inquiries, saves }) => (
                  <tr key={deal.id} className="hover:bg-slate-50/60">
                    <td className="px-3 py-2.5">
                      <Link href={`/deals/${deal.id}`} className="font-medium text-slate-900 hover:text-brand">
                        {deal.companyName}
                      </Link>
                      <div className="text-xs text-slate-500">
                        {dealRef(deal.id)} · {biz.industry} · {biz.state}
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <DealStatusPill status={deal.status} />
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{money(deal.ebitda)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-600">{deal.teaserViews}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-600">{saves}</td>
                    <td className="px-3 py-2.5 text-right font-semibold tabular-nums">{ndas}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{inquiries}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card>
          <CardHeader title="Recent activity" description="Across all roles" />
          {activity.length === 0 ? (
            <EmptyState title="No activity yet" />
          ) : (
            <ul className="divide-y divide-slate-100">
              {activity.map((a) => {
                const Icon = ACTIVITY_ICON[a.kind];
                const deal = a.dealId ? getDeal(data, a.dealId) : undefined;
                const biz = a.subjectId ? data.businesses.find((b) => b.id === a.subjectId) : undefined;
                const actor = getUser(a.actorUserId);
                return (
                  <li key={a.id} className="flex gap-3 px-4 py-2.5">
                    <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-600">
                      <Icon className="size-3.5" />
                    </span>
                    <div className="min-w-0 flex-1 text-[13px] leading-snug">
                      <div className="text-slate-800">{a.detail}</div>
                      <div className="text-[12px] text-slate-500">
                        {deal ? `${dealRef(deal.id)} · ${deal.companyName}` : biz ? biz.legalName : actor?.firmName}
                        {" · "}
                        {relativeTime(a.createdAt)}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
