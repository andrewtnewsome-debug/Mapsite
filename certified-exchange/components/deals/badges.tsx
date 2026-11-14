import { CheckCircle2, FileSignature, Lock, ShieldCheck, Target } from "lucide-react";
import { brand } from "@/config/brand";
import type { CertifiedBusiness, DealStatus, DealType } from "@/data/types";
import { DEAL_STATUS_LABEL, DEAL_TYPE_LABEL } from "@/data/taxonomy";
import type { CertHealth, CriteriaMatch } from "@/lib/deals";
import { Badge, type Tone } from "@/components/ui/primitives";

const DEAL_TYPE_TONE: Record<DealType, Tone> = {
  minority: "blue",
  majority: "violet",
  full_exit: "dark",
  growth: "green",
};

export function DealTypePill({ type }: { type: DealType }) {
  return <Badge tone={DEAL_TYPE_TONE[type]}>{DEAL_TYPE_LABEL[type]}</Badge>;
}

const STATUS_TONE: Record<DealStatus, Tone> = {
  draft: "slate",
  pending_review: "amber",
  changes_requested: "red",
  live: "green",
  paused: "slate",
};

export function DealStatusPill({ status }: { status: DealStatus }) {
  return (
    <Badge tone={STATUS_TONE[status]} dot>
      {DEAL_STATUS_LABEL[status]}
    </Badge>
  );
}

export function NdaPill({ signed }: { signed: boolean }) {
  return signed ? (
    <Badge tone="green">
      <FileSignature /> NDA signed
    </Badge>
  ) : (
    <Badge tone="slate">
      <Lock /> Teaser only
    </Badge>
  );
}

export function CertBadges({ business, compact }: { business: CertifiedBusiness; compact?: boolean }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <Badge tone="brand" title={`Certified by ${business.certifyingCouncil}`}>
        <ShieldCheck /> {brand.sponsor.short} MBE
      </Badge>
      {!compact &&
        business.additionalCertifications.map((c) => (
          <Badge key={c} tone="slate">
            {c}
          </Badge>
        ))}
      {compact && business.additionalCertifications.length > 0 && (
        <Badge tone="slate">+{business.additionalCertifications.join(", ")}</Badge>
      )}
    </span>
  );
}

export function MatchBadge({ match }: { match?: CriteriaMatch }) {
  if (!match) return null;
  const tone: Tone = match.score === match.total ? "green" : match.score >= match.total - 1 ? "blue" : "slate";
  const label = match.score === match.total ? "Matches your criteria" : `${match.score}/${match.total} criteria`;
  return (
    <Badge tone={tone} title={match.checks.map((c) => `${c.pass ? "✓" : "✗"} ${c.label}`).join("\n")}>
      <Target /> {label}
    </Badge>
  );
}

const CERT_TONE: Record<CertHealth, Tone> = { verified: "green", expiring: "amber", expired: "red", pending: "blue" };
const CERT_LABEL: Record<CertHealth, string> = {
  verified: "Verified",
  expiring: "Expiring soon",
  expired: "Expired",
  pending: "Pending verification",
};

export function CertHealthPill({ status }: { status: CertHealth }) {
  return (
    <Badge tone={CERT_TONE[status]} dot>
      {CERT_LABEL[status]}
    </Badge>
  );
}

export function VerifiedInvestorBadge({ verified }: { verified: boolean }) {
  return verified ? (
    <Badge tone="green">
      <CheckCircle2 /> Verified investor
    </Badge>
  ) : (
    <Badge tone="amber">Verification pending</Badge>
  );
}
