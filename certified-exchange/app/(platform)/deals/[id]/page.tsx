"use client";

import {
  ArrowLeft,
  Check,
  CheckCircle2,
  ChevronRight,
  Eye,
  FileLock2,
  FileSignature,
  FileText,
  FolderLock,
  Info,
  Lock,
  MapPin,
  MessagesSquare,
  ShieldCheck,
  Unlock,
  X,
} from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { brand } from "@/config/brand";
import { STATE_NAMES } from "@/data/businesses";
import { threadId } from "@/data/seed";
import { DEAL_TYPE_LABEL } from "@/data/taxonomy";
import { getUser } from "@/data/users";
import { certHealth, criteriaMatch } from "@/lib/deals";
import { dealRef, margin, money, pct, relativeTime, shortDate } from "@/lib/format";
import { getBusiness, getDeal, inquiryFor, ndaFor, profileByUser } from "@/lib/selectors";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { CertBadges, CertHealthPill, DealStatusPill, DealTypePill, NdaPill } from "@/components/deals/badges";
import { InquiryForm } from "@/components/deals/inquiry-form";
import { NdaModal, SignedNdaDialog } from "@/components/deals/nda-modal";
import { SaveDealButton } from "@/components/deals/save-button";
import { Button, LinkButton } from "@/components/ui/button";
import { Badge, Card, CardBody, CardHeader, EmptyState } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";

export default function DealDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const store = useStore();
  const { data, currentUser, session } = store;
  const [ndaOpen, setNdaOpen] = useState(false);
  const [signedOpen, setSignedOpen] = useState(false);
  const [justUnlocked, setJustUnlocked] = useState(false);
  const inquiryRef = useRef<HTMLDivElement>(null);

  const deal = getDeal(data, id);
  const business = getBusiness(data, deal?.businessId);

  if (!deal || !business) {
    return (
      <Card>
        <EmptyState
          icon={<FileText />}
          title="Listing not found"
          body="This listing may have been removed or the link is incorrect."
          action={<LinkButton href="/deals" variant="outline">Back to the deal feed</LinkButton>}
        />
      </Card>
    );
  }

  const isInvestor = session.role === "investor";
  const isOwnListing = session.role === "owner" && business.ownerUserId === currentUser.id;
  const isAdmin = session.role === "admin";
  const nda = isInvestor ? ndaFor(data, deal.id, currentUser.id) : undefined;
  const unlocked = !!nda || isOwnListing || isAdmin;
  const inquiry = isInvestor ? inquiryFor(data, deal.id, currentUser.id) : undefined;
  const profile = isInvestor ? profileByUser(data, currentUser.id) : undefined;
  const match = criteriaMatch({ deal, business }, profile);
  const owner = getUser(business.ownerUserId);
  const cert = certHealth(business);
  const ref = dealRef(deal.id);
  const ndaCount = data.ndas.filter((n) => n.dealId === deal.id).length;

  // Investors can only see live listings, or paused ones they already hold an NDA for.
  if (isInvestor && deal.status !== "live" && !(deal.status === "paused" && nda)) {
    return (
      <Card>
        <EmptyState
          icon={<Lock />}
          title="This listing is not currently available"
          body="The owner may have paused the listing or it is still in review. Saved deals will reappear in your feed when the listing is live."
          action={<LinkButton href="/deals" variant="outline">Back to the deal feed</LinkButton>}
        />
      </Card>
    );
  }

  const handleSign = (v: { signedName: string; signedTitle: string; firmName: string }) => {
    store.signNda({ dealId: deal.id, ...v });
    setNdaOpen(false);
    setJustUnlocked(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
    toast({ title: "NDA executed. Confidential materials unlocked.", body: `${deal.companyName} · ${deal.city}, ${business.state}` });
  };

  const fin = deal.cim.financials;
  const fy = fin[fin.length - 1];
  const prior = fin[fin.length - 2];
  const growth = prior ? fy.revenue / prior.revenue - 1 : 0;

  return (
    <div className="space-y-5">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 text-[13px] text-slate-500">
        <button type="button" onClick={() => router.back()} className="inline-flex items-center gap-1 hover:text-slate-800">
          <ArrowLeft className="size-3.5" /> Back
        </button>
        <span className="text-slate-300">/</span>
        <Link href={isOwnListing ? "/owner" : isAdmin ? "/admin/listings" : "/deals"} className="hover:text-slate-800">
          {isOwnListing ? "My listing" : isAdmin ? "Listing review" : "Deal Feed"}
        </Link>
        <ChevronRight className="size-3.5 text-slate-300" />
        <span className="font-medium tabular-nums text-slate-700">{ref}</span>
      </div>

      {isAdmin && (
        <Banner tone="blue" icon={<Eye />}>
          Admin view. Confidential fields are visible to {brand.sponsor.short} staff for listing review and are never shown to investors before an NDA.
        </Banner>
      )}
      {isOwnListing && (
        <Banner tone="blue" icon={<Eye />}>
          This is your listing. Investors see the anonymized teaser until they sign the NDA; the company name, city and CIM are then released.
        </Banner>
      )}
      {session.role === "owner" && !isOwnListing && (
        <Banner tone="slate" icon={<Info />}>
          You are viewing another owner&apos;s listing as a business owner. Only the anonymized teaser is shown.
        </Banner>
      )}
      {deal.status === "paused" && isInvestor && (
        <Banner tone="amber" icon={<Info />}>
          The owner has paused this listing. Your NDA and conversation remain available.
        </Banner>
      )}

      {/* Header */}
      <Card className={cn("overflow-hidden", justUnlocked && "reveal")}>
        <div className="px-5 pt-4 pb-4">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] font-medium text-slate-500">
            <span className="tabular-nums">{ref}</span>
            <span className="text-slate-300">·</span>
            <span>{business.industry}</span>
            <span className="text-slate-300">·</span>
            <span className="inline-flex items-center gap-1">
              <MapPin className="size-3.5" />
              {unlocked ? `${deal.city}, ${STATE_NAMES[business.state]}` : `${STATE_NAMES[business.state]} · ${business.region}`}
            </span>
            {(isAdmin || isOwnListing) && (
              <>
                <span className="text-slate-300">·</span>
                <DealStatusPill status={deal.status} />
              </>
            )}
          </div>
          <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 max-w-3xl">
              <h1 className="text-[22px] font-semibold leading-tight tracking-tight text-slate-900">{deal.teaserTitle}</h1>
              {unlocked ? (
                <div className="mt-2 inline-flex items-center gap-2 rounded-md bg-emerald-50 px-2.5 py-1 text-[13.5px] text-emerald-800 ring-1 ring-emerald-200">
                  <Unlock className="size-3.5" />
                  <span className="font-semibold">{deal.companyName}</span>
                  <span className="text-emerald-700">
                    · {deal.city}, {business.state}
                  </span>
                  <Badge tone="green" className="ml-1">Confidential</Badge>
                </div>
              ) : (
                <div className="mt-2 inline-flex items-center gap-2 rounded-md bg-slate-100 px-2.5 py-1 text-[13px] text-slate-600">
                  <Lock className="size-3.5" />
                  <span className="select-none font-medium tracking-wide text-slate-400 blur-[3px]">Company Name Withheld</span>
                  <span>· Company name and city released after NDA</span>
                </div>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {isInvestor && <SaveDealButton dealId={deal.id} withLabel />}
              {isInvestor && !nda && (
                <Button size="md" onClick={() => setNdaOpen(true)}>
                  <FileSignature /> Pursue This Deal
                </Button>
              )}
              {unlocked && (
                <LinkButton href={`/deals/${deal.id}/cim`} variant={isInvestor ? "outline" : "default"}>
                  <FileText /> View CIM
                </LinkButton>
              )}
              {isInvestor && nda && !inquiry && (
                <Button onClick={() => inquiryRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}>
                  <MessagesSquare /> Send inquiry
                </Button>
              )}
              {isInvestor && inquiry && (
                <LinkButton href={`/messages?thread=${threadId(deal.id, currentUser.id)}`}>
                  <MessagesSquare /> Open conversation
                </LinkButton>
              )}
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <DealTypePill type={deal.dealType} />
            <CertBadges business={business} />
            {isInvestor && <NdaPill signed={!!nda} />}
          </div>
        </div>

        <dl className="grid grid-cols-2 gap-px border-t border-slate-200 bg-slate-200 sm:grid-cols-3 lg:grid-cols-6">
          <Metric label="Revenue (FY2025)" value={money(deal.revenue)} sub={`${growth >= 0 ? "+" : ""}${pct(growth)} YoY`} />
          <Metric label="Adj. EBITDA" value={money(deal.ebitda)} sub={`${pct(margin(deal.ebitda, deal.revenue))} margin`} />
          <Metric label="Asking valuation" value={deal.askingValuation ? money(deal.askingValuation) : "Open"} sub={deal.askingValuation ? `${(deal.askingValuation / deal.ebitda).toFixed(1)}x adj. EBITDA` : "Not specified"} />
          <Metric label="Deal type" value={DEAL_TYPE_LABEL[deal.dealType]} />
          <Metric label="Employees" value={business.employeeRange} />
          <Metric label="Years in business" value={String(business.yearsInBusiness)} sub={`Est. ${new Date().getFullYear() - business.yearsInBusiness}`} />
        </dl>
      </Card>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-5">
          <Card>
            <CardHeader title="Business overview" description={unlocked ? undefined : "Anonymized teaser prepared by the owner and reviewed by platform staff"} />
            <CardBody className="space-y-4">
              <p className="text-[14px] leading-relaxed text-slate-700">{deal.teaserDescription}</p>
              <div>
                <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-slate-500">Investment highlights</h3>
                <ul className="space-y-1.5">
                  {deal.highlights.map((h) => (
                    <li key={h} className="flex gap-2 text-[13.5px] leading-relaxed text-slate-700">
                      <Check className="mt-0.5 size-4 shrink-0 text-brand" />
                      {h}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3">
                <h3 className="text-[12px] font-semibold uppercase tracking-wide text-slate-500">What the owner is looking for</h3>
                <p className="mt-1 text-[13.5px] leading-relaxed text-slate-700">{deal.seeking}</p>
              </div>
            </CardBody>
          </Card>

          {/* Documents */}
          <Card>
            <CardHeader
              title="Documents"
              description={unlocked ? "Confidential materials released under your NDA" : "Confidential materials are released after the NDA is signed"}
            />
            <ul className="divide-y divide-slate-100">
              <DocRow
                icon={unlocked ? <FileText /> : <FileLock2 />}
                title="Confidential Information Memorandum"
                meta={`Company overview, FY2023–FY2025 financials, customers, operations, management · ${ref}`}
                locked={!unlocked}
                action={
                  unlocked ? (
                    <LinkButton href={`/deals/${deal.id}/cim`} size="sm" variant="outline">
                      Open CIM
                    </LinkButton>
                  ) : isInvestor ? (
                    <Button size="sm" variant="outline" onClick={() => setNdaOpen(true)}>
                      <Lock /> Sign NDA to unlock
                    </Button>
                  ) : undefined
                }
              />
              <DocRow
                icon={unlocked ? <FileText /> : <FileLock2 />}
                title="Three-year financial summary"
                meta="Revenue, gross profit, adjusted EBITDA and capital expenditures (included in the CIM)"
                locked={!unlocked}
                action={
                  unlocked ? (
                    <LinkButton href={`/deals/${deal.id}/cim#financials`} size="sm" variant="ghost">
                      View
                    </LinkButton>
                  ) : undefined
                }
              />
              <DocRow
                icon={<FolderLock />}
                title="Due diligence data room"
                meta="Opened by the owner after a signed letter of intent"
                locked
                action={<span className="text-[12px] text-slate-400">After LOI</span>}
                // TODO(data-room): real document storage and access control are out of scope for the prototype.
              />
            </ul>
          </Card>

          {/* Inquiry */}
          {isInvestor && nda && (
            <div ref={inquiryRef} className="scroll-mt-20">
              <Card className={cn(justUnlocked && !inquiry && "ring-2 ring-brand/30")}>
                {inquiry ? (
                  <>
                    <CardHeader
                      title="Inquiry sent"
                      description={`Sent ${relativeTime(inquiry.createdAt)} to ${owner?.name}, ${owner?.title}`}
                      actions={
                        <LinkButton href={`/messages?thread=${threadId(deal.id, currentUser.id)}`} size="sm">
                          <MessagesSquare /> Open conversation
                        </LinkButton>
                      }
                    />
                    <CardBody className="space-y-3">
                      <p className="whitespace-pre-line text-[13.5px] leading-relaxed text-slate-700">{inquiry.message}</p>
                      <dl className="grid gap-3 border-t border-slate-100 pt-3 text-[13px] sm:grid-cols-3">
                        <Answer label="Criteria fit" value={inquiry.criteriaFit} />
                        <Answer label="Capital available" value={inquiry.capitalAvailable} />
                        <Answer label="Timeline" value={inquiry.timeline} />
                      </dl>
                    </CardBody>
                  </>
                ) : (
                  <>
                    <CardHeader
                      title={`Send an inquiry to ${owner?.name.split(" ")[0]}`}
                      description="Your message starts a private conversation with the owner. Answers to the three standard questions help owners compare investors."
                    />
                    <CardBody>
                      <InquiryForm
                        ownerFirstName={owner?.name.split(" ")[0] ?? "the owner"}
                        onSubmit={(v) => {
                          store.sendInquiry({ dealId: deal.id, ...v });
                          toast({ title: "Inquiry sent", body: `${owner?.name} will be notified. The conversation is in Messages.` });
                        }}
                      />
                    </CardBody>
                  </>
                )}
              </Card>
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-5 lg:sticky lg:top-20">
          {isInvestor && !nda && (
            <Card className="border-brand/30">
              <CardBody>
                <div className="flex items-center gap-2 text-[14px] font-semibold text-slate-900">
                  <Lock className="size-4 text-brand" /> Confidential details
                </div>
                <p className="mt-1 text-[13px] text-slate-600">Sign the platform&apos;s standard NDA to unlock:</p>
                <ul className="mt-2 space-y-1.5 text-[13px] text-slate-700">
                  {["Company name and city", "Full CIM with three-year financials", "Customer and operations detail", "Direct messaging with the owner"].map((x) => (
                    <li key={x} className="flex items-center gap-2">
                      <Unlock className="size-3.5 text-slate-400" /> {x}
                    </li>
                  ))}
                </ul>
                <Button className="mt-4 w-full" onClick={() => setNdaOpen(true)}>
                  <FileSignature /> Pursue This Deal
                </Button>
                <p className="mt-2 text-center text-[11.5px] text-slate-500">
                  Standard form {brand.ndaVersion} · signs in under a minute
                </p>
              </CardBody>
            </Card>
          )}

          {nda && (
            <Card>
              <CardBody>
                <div className="flex items-center gap-2 text-[14px] font-semibold text-slate-900">
                  <CheckCircle2 className="size-4 text-emerald-600" /> NDA executed
                </div>
                <dl className="mt-2 space-y-1 text-[13px]">
                  <Row k="Signed by" v={`${nda.signedName}${nda.signedTitle ? `, ${nda.signedTitle}` : ""}`} />
                  <Row k="Firm" v={nda.firmName} />
                  <Row k="Date" v={shortDate(nda.signedAt)} />
                  <Row k="Agreement" v={nda.version} />
                </dl>
                <Button variant="outline" size="sm" className="mt-3 w-full" onClick={() => setSignedOpen(true)}>
                  View signed NDA
                </Button>
              </CardBody>
            </Card>
          )}

          <Card>
            <CardHeader title="Certification" />
            <CardBody className="space-y-2.5 text-[13px]">
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 font-medium text-slate-900">
                  <ShieldCheck className="size-4 text-brand" /> {brand.sponsor.short} Minority Business Enterprise
                </span>
              </div>
              <dl className="space-y-1">
                <Row k="Certifying council" v={business.certifyingCouncil} />
                <Row k="Status" v={<CertHealthPill status={cert.status} />} />
                <Row k="Expires" v={shortDate(business.certificationExpiry)} />
                {unlocked && <Row k="Certificate no." v={business.certificationNumber} />}
                {business.additionalCertifications.length > 0 && <Row k="Also certified" v={business.additionalCertifications.join(", ")} />}
              </dl>
              <p className="rounded-md bg-slate-50 px-3 py-2 text-[12px] leading-relaxed text-slate-600">
                MBE certification requires at least 51% minority ownership, operation and control. Structures that transfer majority ownership may affect the company&apos;s certification.
              </p>
            </CardBody>
          </Card>

          {match && (
            <Card>
              <CardHeader title="Fit with your criteria" description={`${match.score} of ${match.total} criteria met · ${profile?.firmName}`} />
              <CardBody>
                <ul className="space-y-1.5 text-[13px]">
                  {match.checks.map((c) => (
                    <li key={c.label} className="flex items-center gap-2">
                      {c.pass ? <Check className="size-4 text-emerald-600" /> : <X className="size-4 text-slate-400" />}
                      <span className={c.pass ? "text-slate-800" : "text-slate-500"}>{c.label}</span>
                    </li>
                  ))}
                </ul>
                <Link href="/profile" className="mt-2 inline-block text-[12.5px] font-medium text-brand hover:underline">
                  Edit investment criteria
                </Link>
              </CardBody>
            </Card>
          )}

          <Card>
            <CardHeader title="Listing details" />
            <CardBody>
              <dl className="space-y-1 text-[13px]">
                <Row k="Reference" v={ref} />
                <Row k="Listed" v={deal.listedAt ? shortDate(deal.listedAt) : "Not yet listed"} />
                <Row k="Region" v={business.region} />
                <Row k="State" v={STATE_NAMES[business.state]} />
                {(isOwnListing || isAdmin) && (
                  <>
                    <Row k="Teaser views" v={deal.teaserViews.toLocaleString()} />
                    <Row k="NDAs signed" v={String(ndaCount)} />
                  </>
                )}
              </dl>
            </CardBody>
          </Card>
        </div>
      </div>

      {isInvestor && (
        <NdaModal
          open={ndaOpen}
          onClose={() => setNdaOpen(false)}
          dealId={deal.id}
          defaultFirm={currentUser.firmName}
          defaultTitle={currentUser.title}
          onSign={handleSign}
        />
      )}
      {nda && <SignedNdaDialog open={signedOpen} onClose={() => setSignedOpen(false)} nda={nda} />}
    </div>
  );
}

function Metric({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-slate-50 px-5 py-3">
      <dt className="text-[10.5px] font-medium uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-[17px] font-semibold tabular-nums text-slate-900">{value}</dd>
      {sub && <dd className="text-[12px] tabular-nums text-slate-500">{sub}</dd>}
    </div>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="shrink-0 text-slate-500">{k}</dt>
      <dd className="text-right font-medium text-slate-800">{v}</dd>
    </div>
  );
}

function Answer({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-slate-800">{value}</dd>
    </div>
  );
}

function DocRow({
  icon,
  title,
  meta,
  locked,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  meta: string;
  locked: boolean;
  action?: React.ReactNode;
}) {
  return (
    <li className="flex items-center gap-3 px-5 py-3">
      <span
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-md [&_svg]:size-4",
          locked ? "bg-slate-100 text-slate-400" : "bg-brand/10 text-brand",
        )}
      >
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-[13.5px] font-medium text-slate-900">
          {title}
          {locked ? <Badge tone="amber"><Lock /> Locked</Badge> : <Badge tone="green"><Unlock /> Available</Badge>}
        </div>
        <div className="text-[12px] text-slate-500">{meta}</div>
      </div>
      {action}
    </li>
  );
}

function Banner({ tone, icon, children }: { tone: "blue" | "amber" | "slate"; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        "flex items-start gap-2.5 rounded-lg border px-4 py-2.5 text-[13px] [&_svg]:mt-0.5 [&_svg]:size-4 [&_svg]:shrink-0",
        tone === "blue" && "border-sky-200 bg-sky-50 text-sky-900",
        tone === "amber" && "border-amber-200 bg-amber-50 text-amber-900",
        tone === "slate" && "border-slate-200 bg-slate-50 text-slate-700",
      )}
    >
      {icon}
      <div>{children}</div>
    </div>
  );
}
