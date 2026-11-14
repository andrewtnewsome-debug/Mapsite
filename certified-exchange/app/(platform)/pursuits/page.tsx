"use client";

import { FileSignature } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { threadId } from "@/data/seed";
import type { NDA } from "@/data/types";
import { dealRef, money, relativeTime, shortDate } from "@/lib/format";
import { getBusiness, getDeal, inquiryFor, threadsFor } from "@/lib/selectors";
import { useStore } from "@/lib/store";
import { DealTypePill } from "@/components/deals/badges";
import { SignedNdaDialog } from "@/components/deals/nda-modal";
import { RoleGate } from "@/components/shell/role-gate";
import { Button, LinkButton } from "@/components/ui/button";
import { Badge, Card, CardHeader, EmptyState, PageHeader, Stat } from "@/components/ui/primitives";

export default function PursuitsPage() {
  return (
    <RoleGate allow={["investor"]}>
      <Pursuits />
    </RoleGate>
  );
}

function Pursuits() {
  const { data, currentUser, session } = useStore();
  const [viewing, setViewing] = useState<NDA | null>(null);
  const ndas = data.ndas.filter((n) => n.investorUserId === currentUser.id).sort((a, b) => b.signedAt.localeCompare(a.signedAt));
  const threads = threadsFor(data, currentUser, session.role);
  const inquiries = ndas.filter((n) => inquiryFor(data, n.dealId, currentUser.id)).length;
  const replied = threads.filter((t) => t.messages.some((m) => m.senderUserId !== currentUser.id)).length;

  return (
    <>
      <PageHeader
        title="Pursuits & NDAs"
        description="Every deal you have pursued, the NDA you signed, and where each conversation stands."
        actions={<LinkButton href="/deals" variant="outline">Find more deals</LinkButton>}
      />
      <Card className="mb-5">
        <div className="grid grid-cols-2 divide-x divide-slate-200 sm:grid-cols-4">
          <Stat className="px-5 py-4" label="NDAs signed" value={ndas.length} />
          <Stat className="px-5 py-4" label="Inquiries sent" value={inquiries} />
          <Stat className="px-5 py-4" label="Owner replies" value={replied} />
          <Stat className="px-5 py-4" label="Awaiting inquiry" value={ndas.length - inquiries} />
        </div>
      </Card>

      <Card>
        <CardHeader title="Active pursuits" description={`${ndas.length} signed ${ndas.length === 1 ? "agreement" : "agreements"}`} />
        {ndas.length === 0 ? (
          <EmptyState
            icon={<FileSignature />}
            title="No pursuits yet"
            body="When you sign an NDA on a deal, it appears here with its CIM, the signed agreement and your conversation with the owner."
            action={<LinkButton href="/deals">Browse the deal feed</LinkButton>}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-[13px]">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-2.5">Company</th>
                  <th className="px-4 py-2.5">Deal</th>
                  <th className="px-4 py-2.5 text-right">Revenue</th>
                  <th className="px-4 py-2.5 text-right">EBITDA</th>
                  <th className="px-4 py-2.5">NDA signed</th>
                  <th className="px-4 py-2.5">Stage</th>
                  <th className="px-4 py-2.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {ndas.map((n) => {
                  const deal = getDeal(data, n.dealId);
                  const biz = getBusiness(data, deal?.businessId);
                  if (!deal || !biz) return null;
                  const inq = inquiryFor(data, deal.id, currentUser.id);
                  const thread = threads.find((t) => t.id === threadId(deal.id, currentUser.id));
                  const ownerReplied = thread?.messages.some((m) => m.senderUserId !== currentUser.id);
                  return (
                    <tr key={n.id} className="align-top hover:bg-slate-50/60">
                      <td className="px-4 py-3">
                        <Link href={`/deals/${deal.id}`} className="font-medium text-slate-900 hover:text-brand">
                          {deal.companyName}
                        </Link>
                        <div className="text-xs text-slate-500">
                          {dealRef(deal.id)} · {biz.industry} · {deal.city}, {biz.state}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <DealTypePill type={deal.dealType} />
                        {deal.status === "paused" && <Badge tone="slate" className="ml-1">Paused</Badge>}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">{money(deal.revenue)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{money(deal.ebitda)}</td>
                      <td className="px-4 py-3 text-slate-600">{shortDate(n.signedAt)}</td>
                      <td className="px-4 py-3">
                        {ownerReplied ? (
                          <Badge tone="green" dot>Owner replied</Badge>
                        ) : inq ? (
                          <Badge tone="blue" dot>Inquiry sent</Badge>
                        ) : (
                          <Badge tone="amber" dot>NDA signed</Badge>
                        )}
                        {thread && <div className="mt-1 text-[11.5px] text-slate-400">Last activity {relativeTime(thread.last.createdAt)}</div>}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-1.5">
                          <Button size="sm" variant="ghost" onClick={() => setViewing(n)}>
                            NDA
                          </Button>
                          <LinkButton size="sm" variant="ghost" href={`/deals/${deal.id}/cim`}>
                            CIM
                          </LinkButton>
                          {thread ? (
                            <LinkButton size="sm" variant="outline" href={`/messages?thread=${thread.id}`}>
                              Messages{thread.unread ? ` (${thread.unread})` : ""}
                            </LinkButton>
                          ) : (
                            <LinkButton size="sm" href={`/deals/${deal.id}`}>
                              Send inquiry
                            </LinkButton>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {viewing && <SignedNdaDialog open onClose={() => setViewing(null)} nda={viewing} />}
    </>
  );
}
