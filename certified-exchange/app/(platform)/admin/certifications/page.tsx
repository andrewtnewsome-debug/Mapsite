"use client";

import { Bell, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { brand } from "@/config/brand";
import { getUser } from "@/data/users";
import { certHealth } from "@/lib/deals";
import { dealRef, shortDate } from "@/lib/format";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { CertHealthPill, DealStatusPill } from "@/components/deals/badges";
import { RoleGate } from "@/components/shell/role-gate";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";

export default function AdminCertificationsPage() {
  return (
    <RoleGate allow={["admin"]}>
      <AdminCertifications />
    </RoleGate>
  );
}

function AdminCertifications() {
  const { data, verifyCertification } = useStore();
  const toast = useToast();
  const [filter, setFilter] = useState<"attention" | "all">("attention");

  const rows = data.businesses
    .map((b) => ({ b, health: certHealth(b), deal: data.deals.find((d) => d.businessId === b.id) }))
    .sort((x, y) => x.health.days - y.health.days);
  const attention = rows.filter((r) => r.health.status !== "verified");
  const shown = filter === "attention" ? attention : rows;

  return (
    <>
      <PageHeader
        title="Certification verification"
        description={`Confirm each business's ${brand.sponsor.short} MBE certificate with its certifying council and track upcoming expirations.`}
      />
      <Card>
        <CardHeader
          title={filter === "attention" ? "Needs attention" : "All certified businesses"}
          description={`${attention.length} pending, expiring or expired · ${rows.length} businesses total`}
          actions={
            <div className="flex rounded-md border border-slate-200 p-0.5">
              {(["attention", "all"] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFilter(f)}
                  className={cn("rounded px-2.5 py-1 text-[12.5px] font-medium", filter === f ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100")}
                >
                  {f === "attention" ? `Needs attention (${attention.length})` : `All (${rows.length})`}
                </button>
              ))}
            </div>
          }
        />
        {shown.length === 0 ? (
          <EmptyState icon={<ShieldCheck />} title="All certifications are verified and current" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px] text-[13px]">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-2.5">Business</th>
                  <th className="px-4 py-2.5">Certifying council</th>
                  <th className="px-4 py-2.5">Certificate</th>
                  <th className="px-4 py-2.5">Expires</th>
                  <th className="px-4 py-2.5">Status</th>
                  <th className="px-4 py-2.5">Listing</th>
                  <th className="px-4 py-2.5 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {shown.map(({ b, health, deal }) => (
                  <tr key={b.id} className="hover:bg-slate-50/60">
                    <td className="px-4 py-2.5">
                      <div className="font-medium text-slate-900">{b.legalName}</div>
                      <div className="text-xs text-slate-500">
                        {getUser(b.ownerUserId)?.name} · {b.industry} · {b.state}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-slate-700">{b.certifyingCouncil}</td>
                    <td className="px-4 py-2.5">
                      <div className="tabular-nums text-slate-700">{b.certificationNumber}</div>
                      <div className="text-xs text-slate-500">
                        MBE{b.additionalCertifications.length ? ` + ${b.additionalCertifications.join(", ")}` : ""}
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="text-slate-700">{shortDate(b.certificationExpiry)}</div>
                      <div className={cn("text-xs tabular-nums", health.days < 0 ? "text-red-600" : health.days <= 90 ? "text-amber-700" : "text-slate-500")}>
                        {health.days < 0 ? `${Math.abs(health.days)} days ago` : `in ${health.days} days`}
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      <CertHealthPill status={health.status} />
                      {b.verifiedAt && <div className="mt-0.5 text-[11px] text-slate-400">Verified {shortDate(b.verifiedAt)}</div>}
                    </td>
                    <td className="px-4 py-2.5">
                      {deal ? (
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs tabular-nums text-slate-500">{dealRef(deal.id)}</span>
                          <DealStatusPill status={deal.status} />
                        </div>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {b.verification === "pending" && health.status !== "expired" ? (
                        <Button
                          size="sm"
                          onClick={() => {
                            // TODO(nmsdc-api): verify against the council's certification records instead of a manual click.
                            verifyCertification(b.id);
                            toast({ title: "Certification verified", body: `${b.legalName} · ${b.certifyingCouncil}` });
                          }}
                        >
                          <ShieldCheck /> Verify with council
                        </Button>
                      ) : health.status === "expired" || health.status === "expiring" ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            // TODO(email): renewal reminders would be sent by email; out of scope for the prototype.
                            toast({ tone: "info", title: "Renewal reminder queued", body: `Email sending is mocked. ${getUser(b.ownerUserId)?.name} would be reminded to renew.` })
                          }
                        >
                          <Bell /> Send renewal reminder
                        </Button>
                      ) : (
                        <span className="text-xs text-slate-400">No action needed</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
