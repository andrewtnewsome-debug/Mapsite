"use client";

import { ArrowLeft, Lock } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { dealForOwner } from "@/lib/selectors";
import { useStore } from "@/lib/store";
import { InvestorProfileView } from "@/components/investors/profile-view";
import { LinkButton } from "@/components/ui/button";
import { Card, EmptyState } from "@/components/ui/primitives";

export default function InvestorProfilePage() {
  const { id } = useParams<{ id: string }>();
  const { data, currentUser, session } = useStore();
  const profile = data.investorProfiles.find((p) => p.id === id);

  if (!profile) {
    return (
      <Card>
        <EmptyState title="Investor not found" />
      </Card>
    );
  }

  const ndaCount = data.ndas.filter((n) => n.investorUserId === profile.userId).length;
  const back =
    session.role === "admin" ? { href: "/admin/investors", label: "Investor verification" } : { href: "/owner/inquiries", label: "Investor pursuits" };

  if (session.role === "investor") {
    if (profile.userId === currentUser.id) return <InvestorProfileView profile={profile} mode="self" ndaCount={ndaCount} />;
    return (
      <Card>
        <EmptyState icon={<Lock />} title="Investor profiles are private" body="Other investors' profiles are visible only to business owners they have signed an NDA with." action={<LinkButton href="/profile">View my firm profile</LinkButton>} />
      </Card>
    );
  }

  if (session.role === "owner") {
    const { deal } = dealForOwner(data, currentUser.id);
    const signed = deal && data.ndas.some((n) => n.dealId === deal.id && n.investorUserId === profile.userId);
    if (!signed) {
      return (
        <Card>
          <EmptyState
            icon={<Lock />}
            title="Profile available after NDA"
            body="You can see an investor's firm profile once they sign the NDA on your listing."
            action={<LinkButton href="/owner/inquiries" variant="outline">Back to investor pursuits</LinkButton>}
          />
        </Card>
      );
    }
  }

  return (
    <div className="space-y-4">
      <Link href={back.href} className="inline-flex items-center gap-1 text-[13px] text-slate-500 hover:text-slate-800">
        <ArrowLeft className="size-3.5" /> {back.label}
      </Link>
      <InvestorProfileView profile={profile} mode={session.role === "admin" ? "admin" : "owner"} ndaCount={ndaCount} />
    </div>
  );
}
