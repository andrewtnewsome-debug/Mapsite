"use client";

import { Bookmark, Eye, Inbox, Lock } from "lucide-react";
import Link from "next/link";
import { getUser } from "@/data/users";
import { money, relativeTime, shortDate } from "@/lib/format";
import { inquiryFor, profileByUser } from "@/lib/selectors";
import { useStore } from "@/lib/store";
import { VerifiedInvestorBadge } from "@/components/deals/badges";
import { useOwnerListing } from "@/components/owner/use-owner";
import { RoleGate } from "@/components/shell/role-gate";
import { LinkButton } from "@/components/ui/button";
import { Badge, Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/primitives";

export default function OwnerInquiriesPage() {
  return (
    <RoleGate allow={["owner"]}>
      <OwnerInquiries />
    </RoleGate>
  );
}

function OwnerInquiries() {
  const { data } = useStore();
  const { deal, ndas, saves, threads } = useOwnerListing();
  if (!deal) return null;

  return (
    <>
      <PageHeader
        title="Investor pursuits"
        description="Every investor who has signed the NDA on your listing, with their firm profile, inquiry answers and conversation."
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <Card className="flex items-center gap-3 px-4 py-3">
          <Eye className="size-5 text-slate-400" />
          <div>
            <div className="text-lg font-semibold tabular-nums">{deal.teaserViews.toLocaleString()}</div>
            <div className="text-[12px] text-slate-500">Anonymous teaser views</div>
          </div>
        </Card>
        <Card className="flex items-center gap-3 px-4 py-3">
          <Bookmark className="size-5 text-slate-400" />
          <div>
            <div className="text-lg font-semibold tabular-nums">{saves}</div>
            <div className="text-[12px] text-slate-500">Anonymous watchlist saves</div>
          </div>
        </Card>
        <Card className="flex items-center gap-3 px-4 py-3">
          <Lock className="size-5 text-brand" />
          <div>
            <div className="text-lg font-semibold tabular-nums">{ndas.length}</div>
            <div className="text-[12px] text-slate-500">Investors under NDA (identified below)</div>
          </div>
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Investors under NDA"
          description="Investors who have only viewed or saved your teaser stay anonymous. Firms appear here once they sign the NDA."
        />
        {ndas.length === 0 ? (
          <EmptyState
            icon={<Inbox />}
            title="No investors under NDA yet"
            body="When an investor signs the NDA on your listing you will see their firm, criteria and inquiry here."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px] text-[13px]">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-2.5">Investor</th>
                  <th className="px-4 py-2.5">Type</th>
                  <th className="px-4 py-2.5">Check size</th>
                  <th className="px-4 py-2.5">NDA signed</th>
                  <th className="px-4 py-2.5">Inquiry</th>
                  <th className="px-4 py-2.5">Last message</th>
                  <th className="px-4 py-2.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {ndas.map((n) => {
                  const profile = profileByUser(data, n.investorUserId);
                  const user = getUser(n.investorUserId);
                  const inq = inquiryFor(data, deal.id, n.investorUserId);
                  const thread = threads.find((t) => t.investorUserId === n.investorUserId);
                  return (
                    <tr key={n.id} className="align-top hover:bg-slate-50/60">
                      <td className="px-4 py-3">
                        <Link href={`/investors/${profile?.id}`} className="font-medium text-slate-900 hover:text-brand">
                          {n.firmName}
                        </Link>
                        <div className="text-xs text-slate-500">
                          {user?.name}, {user?.title}
                        </div>
                        {profile && <div className="mt-1"><VerifiedInvestorBadge verified={profile.verified} /></div>}
                      </td>
                      <td className="px-4 py-3 text-slate-700">
                        {profile?.firmType}
                        <div className="text-xs text-slate-500">{profile?.headquarters}</div>
                      </td>
                      <td className="px-4 py-3 tabular-nums text-slate-700">
                        {profile ? `${money(profile.checkSizeMin)} – ${money(profile.checkSizeMax)}` : "—"}
                      </td>
                      <td className="px-4 py-3 text-slate-600">{shortDate(n.signedAt)}</td>
                      <td className="max-w-[260px] px-4 py-3">
                        {inq ? (
                          <>
                            <Badge tone="blue">Received {relativeTime(inq.createdAt)}</Badge>
                            <div className="mt-1 text-xs text-slate-600">{inq.criteriaFit.split(":")[0]} · {inq.timeline}</div>
                          </>
                        ) : (
                          <span className="text-xs text-slate-500">Reviewing CIM; no inquiry yet</span>
                        )}
                      </td>
                      <td className="max-w-[240px] px-4 py-3">
                        {thread ? (
                          <>
                            <p className="line-clamp-2 text-xs text-slate-600">{thread.last.body}</p>
                            <div className="mt-0.5 text-[11px] text-slate-400">{relativeTime(thread.last.createdAt)}</div>
                          </>
                        ) : (
                          <span className="text-xs text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-1.5">
                          <LinkButton size="sm" variant="ghost" href={`/investors/${profile?.id}`}>
                            Profile
                          </LinkButton>
                          {thread && (
                            <LinkButton size="sm" variant={thread.unread ? "default" : "outline"} href={`/messages?thread=${thread.id}`}>
                              {thread.unread ? `Reply (${thread.unread})` : "Thread"}
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
    </>
  );
}
