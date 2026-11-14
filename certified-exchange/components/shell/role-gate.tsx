"use client";

import { Lock } from "lucide-react";
import { useRouter } from "next/navigation";
import type { Role } from "@/data/types";
import { useStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Card, EmptyState } from "@/components/ui/primitives";
import { ROLE_HOME, ROLE_LABEL } from "./nav";

/** Renders children only for the allowed roles; otherwise offers a role switch. */
export function RoleGate({ allow, children }: { allow: Role[]; children: React.ReactNode }) {
  const { session, setRole } = useStore();
  const router = useRouter();
  if (allow.includes(session.role)) return <>{children}</>;
  const target = allow[0];
  return (
    <Card>
      <EmptyState
        icon={<Lock />}
        title={`This page is part of the ${ROLE_LABEL[target]} workspace`}
        body={`You are currently viewing the platform as ${ROLE_LABEL[session.role]}. Switch roles to continue.`}
        action={
          <div className="flex gap-2">
            <Button
              onClick={() => {
                setRole(target);
              }}
            >
              Switch to {ROLE_LABEL[target]}
            </Button>
            <Button variant="outline" onClick={() => router.push(ROLE_HOME[session.role])}>
              Back to my workspace
            </Button>
          </div>
        }
      />
    </Card>
  );
}
