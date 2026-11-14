"use client";

import Link from "next/link";
import { brand } from "@/config/brand";
import { DEAL_TYPE_SHORT } from "@/data/taxonomy";
import { getUser } from "@/data/users";
import { money } from "@/lib/format";
import { useStore } from "@/lib/store";
import { VerifiedInvestorBadge } from "@/components/deals/badges";
import { RoleGate } from "@/components/shell/role-gate";
import { Card, CardHeader, PageHeader, Switch } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";

export default function AdminInvestorsPage() {
  return (
    <RoleGate allow={["admin"]}>
      <AdminInvestors />
    </RoleGate>
  );
}

function AdminInvestors() {
  const { data, setInvestorVerified } = useStore();
  const toast = useToast();
  const verified = data.investorProfiles.filter((p) => p.verified).length;

  return (
    <>
      <PageHeader
        title="Investor verification"
        description={`Verified investors show a badge to business owners. Mark a firm verified once ${brand.sponsor.short} staff have confirmed identity, investment authority and source of capital.`}
      />
      <Card>
        <CardHeader title="Registered investors" description={`${verified} of ${data.investorProfiles.length} verified`} />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-[13px]">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                <th className="px-4 py-2.5">Firm</th>
                <th className="px-4 py-2.5">Type</th>
                <th className="px-4 py-2.5">Check size</th>
                <th className="px-4 py-2.5">Target EBITDA</th>
                <th className="px-4 py-2.5">Deal types</th>
                <th className="px-4 py-2.5 text-right">NDAs</th>
                <th className="px-4 py-2.5 text-right">Inquiries</th>
                <th className="px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5 text-right">Verified</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.investorProfiles.map((p) => {
                const user = getUser(p.userId);
                return (
                  <tr key={p.id} className="hover:bg-slate-50/60">
                    <td className="px-4 py-2.5">
                      <Link href={`/investors/${p.id}`} className="font-medium text-slate-900 hover:text-brand">
                        {p.firmName}
                      </Link>
                      <div className="text-xs text-slate-500">
                        {user?.name} · {p.headquarters}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-slate-700">{p.firmType}</td>
                    <td className="px-4 py-2.5 tabular-nums text-slate-700">
                      {money(p.checkSizeMin)} – {money(p.checkSizeMax)}
                    </td>
                    <td className="px-4 py-2.5 tabular-nums text-slate-700">
                      {money(p.ebitdaMin)} – {money(p.ebitdaMax)}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-slate-600">{p.dealTypes.map((d) => DEAL_TYPE_SHORT[d]).join(", ")}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{data.ndas.filter((n) => n.investorUserId === p.userId).length}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{data.inquiries.filter((i) => i.investorUserId === p.userId).length}</td>
                    <td className="px-4 py-2.5">
                      <VerifiedInvestorBadge verified={p.verified} />
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex justify-end">
                        <Switch
                          checked={p.verified}
                          label={`Verified: ${p.firmName}`}
                          onChange={(v) => {
                            setInvestorVerified(p.id, v);
                            toast({ title: v ? `${p.firmName} marked verified` : `Verification removed for ${p.firmName}` });
                          }}
                        />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
