import Link from "next/link";
import { Database, PlugZap } from "lucide-react";
import type { WorkspaceStatus } from "@/lib/server/workspace";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/states";

/** Shown when the selected data source has nothing to display. Demo data is never substituted. */
export function NoData({ status }: { status: WorkspaceStatus }) {
  const copy: Record<Exclude<WorkspaceStatus["kind"], "ready">, { title: string; description: string }> = {
    "qbo-not-configured": {
      title: "QuickBooks Sandbox keys are not set up yet",
      description: "Add your Intuit development keys to .env.local (see SETUP_GUIDE.md), restart FinanceOS, then connect from Settings. You can switch back to the Demo Company at any time.",
    },
    "qbo-not-connected": {
      title: "QuickBooks Sandbox is not connected",
      description: "Connect your sandbox company from Settings to see its data here. Demo data is kept separate and is not shown while QuickBooks Sandbox is selected.",
    },
    "qbo-not-synced": {
      title: "QuickBooks Sandbox is connected but has not synced",
      description: "Run a sync from Settings to load accounts, invoices, bills, payments and reports.",
    },
  };
  if (status.kind === "ready") return null;
  const c = copy[status.kind];
  return (
    <Card>
      <EmptyState
        icon={status.kind === "qbo-not-synced" ? Database : PlugZap}
        title={c.title}
        description={
          <>
            <p>{c.description}</p>
            {status.kind === "qbo-not-configured" ? (
              <ul className="mt-2 list-disc pl-5 text-left">
                {status.problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            ) : null}
            {status.kind === "qbo-not-synced" && status.lastError ? <p className="mt-2 text-critical-text">Last error: {status.lastError}</p> : null}
          </>
        }
        action={
          <Button asChild variant="primary">
            <Link href="/settings">Open Settings</Link>
          </Button>
        }
      />
    </Card>
  );
}
