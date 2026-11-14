"use client";

import { profileByUser } from "@/lib/selectors";
import { useStore } from "@/lib/store";
import { InvestorProfileView } from "@/components/investors/profile-view";
import { RoleGate } from "@/components/shell/role-gate";
import { Card, EmptyState } from "@/components/ui/primitives";

export default function MyProfilePage() {
  return (
    <RoleGate allow={["investor"]}>
      <MyProfile />
    </RoleGate>
  );
}

function MyProfile() {
  const { data, currentUser } = useStore();
  const profile = profileByUser(data, currentUser.id);
  if (!profile) {
    return (
      <Card>
        <EmptyState title="No investor profile on file" />
      </Card>
    );
  }
  const ndaCount = data.ndas.filter((n) => n.investorUserId === currentUser.id).length;
  return <InvestorProfileView profile={profile} mode="self" ndaCount={ndaCount} />;
}
