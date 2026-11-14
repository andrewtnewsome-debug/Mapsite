"use client";

import { AlertCircle, ArrowRight, CheckCircle2, Circle, Eye, FilePen, Inbox } from "lucide-react";
import Link from "next/link";
import { brand } from "@/config/brand";
import { getUser } from "@/data/users";
import { certHealth } from "@/lib/deals";
import { dealRef, money, relativeTime, shortDate } from "@/lib/format";
import { inquiryFor, profileByUser } from "@/lib/selectors";
import { useStore } from "@/lib/store";
import { DealStatusPill, DealTypePill, VerifiedInvestorBadge } from "@/components/deals/badges";
import { CertificationPanel } from "@/components/owner/cert-panel";
import { useOwnerListing } from "@/components/owner/use-owner";
import { RoleGate } from "@/components/shell/role-gate";
import { LinkButton } from "@/components/ui/button";
import { Badge, Card, CardBody, CardHeader, EmptyState, PageHeader, Stat } from "@/components/ui/primitives";

export default function OwnerOverviewPage() {
  return (
    <RoleGate allow={["owner"]}>
      <OwnerOverview />
    </RoleGate>
  );
}

function OwnerOverview() {
  const { data, currentUser } = useStore();
  const { business, deal, ndas, inquiries, saves, threads, unread } = useOwnerListing();

  if (!business || !deal) {
    return (
      <Card>
        <EmptyState title="No business on file" body="Your certified business record could not be found." />
      </Card>
    );
  }

  const cert = certHealth(business);
  const steps = [
    { label: "Certification verified by platform staff", done: business.verification === "verified" && cert.status !== "expired" },
    { label: "Listing details complete", done: deal.status !== "draft" },
    { label: "Listing approved and live", done: deal.status === "live" || deal.status === "paused" },
    { label: "First investor NDA signed", done: ndas.length > 0 },
    { label: "Respond to investor inquiries", done: inquiries.length > 0 && unread === 0 },
  ];

  return (
    <>
      <PageHeader
        eyebrow={business.legalName}
        title={`Welcome back, ${currentUser.name.split(" ")[0]}`}
        description="Track how investors are engaging with your listing. Investors are identified to you only after they sign the NDA."
        actions={
          <>
            <LinkButton href={`/deals/${deal.id}`} variant="outline">
              <Eye /> Preview listing
            </LinkButton>
            <LinkButton href="/owner/listing">
              <FilePen /> Edit listing
            </LinkButton>
          </>
        }
      />

      {deal.status === "changes_requested" && deal.reviewNote && (
        <div className="mb-5 flex gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-900">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <div>
            <div className="font-medium">{brand.sponsor.short} staff requested changes to your listing</div>
            <p className="mt-0.5">{deal.reviewNote}</p>
            <Link href="/owner/listing" className="mt-1 inline-block font-medium underline">
              Update and resubmit
            </Link>
          </div>
        </div>
      )}

      <Card className="mb-5">
        <div className="grid grid-cols-2 divide-y divide-slate-200 sm:grid-cols-3 sm:divide-y-0 lg:grid-cols-6 lg:divide-x">
          <Stat className="px-5 py-4" label="Listing status" value={<DealStatusPill status={deal.status} />} sub={deal.listedAt ? `Live since ${shortDate(deal.listedAt)}` : deal.submittedAt ? `Submitted ${shortDate(deal.submittedAt)}` : "Not submitted"} />
          <Stat className="px-5 py-4" label="Teaser views" value={deal.teaserViews.toLocaleString()} sub="Anonymous" />
          <Stat className="px-5 py-4" label="Watchlist saves" value={saves} sub="Anonymous" />
          <Stat className="px-5 py-4" label="NDAs signed" value={ndas.length} sub="Identified investors" />
          <Stat className="px-5 py-4" label="Inquiries" value={inquiries.length} />
          <Stat className="px-5 py-4" label="Unread messages" value={unread} />
        </div>
      </Card>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-5">
          <Card>
            <CardHeader
              title="Investors pursuing your business"
              description="Firms that have signed the NDA. Their profiles and inquiries are visible to you."
              actions={
                <LinkButton href="/owner/inquiries" size="sm" variant="ghost">
                  View all <ArrowRight />
                </LinkButton>
              }
            />
            {ndas.length === 0 ? (
              <EmptyState
                icon={<Inbox />}
                title="No NDAs signed yet"
                body={
                  deal.status === "live"
                    ? "Investors are reviewing your teaser. When a firm signs the NDA, it appears here with its profile."
                    : "Once your listing is approved and live, investors who sign the NDA will appear here."
                }
              />
            ) : (
              <ul className="divide-y divide-slate-100">
                {ndas.slice(0, 5).map((n) => {
                  const profile = profileByUser(data, n.investorUserId);
                  const inq = inquiryFor(data, deal.id, n.investorUserId);
                  const thread = threads.find((t) => t.investorUserId === n.investorUserId);
                  return (
                    <li key={n.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Link href={`/investors/${profile?.id}`} className="text-[13.5px] font-medium text-slate-900 hover:text-brand">
                            {n.firmName}
                          </Link>
                          {profile && <VerifiedInvestorBadge verified={profile.verified} />}
                        </div>
                        <div className="text-[12px] text-slate-500">
                          {profile?.firmType} · {getUser(n.investorUserId)?.name} · NDA signed {relativeTime(n.signedAt)}
                        </div>
                      </div>
                      {inq ? <Badge tone="blue">Inquiry received</Badge> : <Badge tone="slate">Reviewing CIM</Badge>}
                      {thread && (
                        <LinkButton href={`/messages?thread=${thread.id}`} size="sm" variant={thread.unread ? "default" : "outline"}>
                          {thread.unread ? `Reply (${thread.unread} new)` : "Open thread"}
                        </LinkButton>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader title="Your listing as investors see it" description={`${dealRef(deal.id)} · anonymized teaser`} />
            <CardBody>
              <div className="text-[11.5px] font-medium text-slate-500">
                {business.industry} · {business.region} · {business.state}
              </div>
              <div className="mt-1 text-[15px] font-semibold text-slate-900">{deal.teaserTitle}</div>
              <p className="mt-1.5 text-[13px] leading-relaxed text-slate-600">{deal.teaserDescription}</p>
              <div className="mt-3 flex flex-wrap items-center gap-3 text-[13px]">
                <DealTypePill type={deal.dealType} />
                <span className="tabular-nums text-slate-700">Revenue {money(deal.revenue)}</span>
                <span className="tabular-nums text-slate-700">Adj. EBITDA {money(deal.ebitda)}</span>
              </div>
            </CardBody>
          </Card>
        </div>

        <div className="space-y-5">
          <CertificationPanel business={business} />
          <Card>
            <CardHeader title="Getting to close" />
            <CardBody>
              <ol className="space-y-2">
                {steps.map((s) => (
                  <li key={s.label} className="flex items-center gap-2 text-[13px]">
                    {s.done ? <CheckCircle2 className="size-4 text-emerald-600" /> : <Circle className="size-4 text-slate-300" />}
                    <span className={s.done ? "text-slate-500 line-through decoration-slate-300" : "text-slate-800"}>{s.label}</span>
                  </li>
                ))}
              </ol>
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
