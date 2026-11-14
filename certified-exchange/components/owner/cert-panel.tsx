"use client";

import { AlertTriangle, ShieldCheck, Upload } from "lucide-react";
import { brand } from "@/config/brand";
import type { CertifiedBusiness } from "@/data/types";
import { certHealth } from "@/lib/deals";
import { shortDate } from "@/lib/format";
import { CertHealthPill } from "@/components/deals/badges";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";

export function CertificationPanel({ business }: { business: CertifiedBusiness }) {
  const toast = useToast();
  const { status, days } = certHealth(business);
  const rows: [string, React.ReactNode][] = [
    ["Certification type", `${brand.sponsor.short} Minority Business Enterprise (MBE)`],
    ["Certifying council", business.certifyingCouncil],
    ["Certificate number", business.certificationNumber],
    ["Expiration date", shortDate(business.certificationExpiry)],
    ["Platform verification", business.verifiedAt ? `Verified ${shortDate(business.verifiedAt)}` : "Awaiting staff verification"],
    ["Additional certifications", business.additionalCertifications.length ? business.additionalCertifications.join(", ") : "None on file"],
  ];

  return (
    <Card>
      <CardHeader title="Certification status" actions={<CertHealthPill status={status} />} />
      <CardBody className="space-y-3">
        <div className="flex items-center gap-3 rounded-md bg-brand/5 px-3 py-2.5">
          <ShieldCheck className="size-5 shrink-0 text-brand" />
          <div className="text-[13px] leading-snug">
            <div className="font-medium text-slate-900">{business.legalName}</div>
            <div className="text-slate-600">
              {days >= 0 ? `${days} days until expiration` : `Expired ${Math.abs(days)} days ago`}
            </div>
          </div>
        </div>
        <dl className="space-y-1.5 text-[13px]">
          {rows.map(([k, v]) => (
            <div key={k} className="flex justify-between gap-3">
              <dt className="text-slate-500">{k}</dt>
              <dd className="text-right font-medium text-slate-800">{v}</dd>
            </div>
          ))}
        </dl>
        {(status === "expiring" || status === "expired") && (
          <div className="flex gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            {status === "expired"
              ? "Your certification has expired. Listings cannot go live until a current certificate is on file."
              : "Your certification expires soon. Renew with your certifying council to keep your listing live."}
          </div>
        )}
        {status === "pending" && (
          <p className="rounded-md bg-sky-50 px-3 py-2 text-[12.5px] text-sky-900">
            {brand.sponsor.short} staff are confirming your certificate with {business.certifyingCouncil}. This usually takes one to two business days.
          </p>
        )}
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          onClick={() =>
            // TODO(uploads): real document upload and council verification are out of scope.
            toast({ tone: "info", title: "Upload is mocked in the prototype", body: "In production, renewal certificates are uploaded here and verified by staff." })
          }
        >
          <Upload /> Upload renewal certificate
        </Button>
      </CardBody>
    </Card>
  );
}
