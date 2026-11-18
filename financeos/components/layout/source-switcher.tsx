"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import type { DataSourceKind } from "@/lib/domain/types";
import { Spinner } from "@/components/ui/spinner";

export function SourceSwitcher({ source }: { source: DataSourceKind }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);

  async function change(next: DataSourceKind) {
    setError(null);
    const res = await fetch("/api/settings/source", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source: next }),
    });
    if (!res.ok) {
      setError("Could not switch data source.");
      return;
    }
    startTransition(() => router.refresh());
  }

  return (
    <div className="flex items-center gap-2">
      <label htmlFor="data-source" className="sr-only">
        Data source
      </label>
      <select
        id="data-source"
        value={source}
        disabled={pending}
        onChange={(e) => change(e.target.value as DataSourceKind)}
        className="h-8 rounded-lg border border-border-strong bg-surface pl-2.5 pr-7 text-[13px] font-medium text-text shadow-card"
      >
        <option value="demo">Demo Company</option>
        <option value="quickbooks-sandbox">QuickBooks Sandbox</option>
      </select>
      {pending ? <Spinner label="Switching data source" /> : null}
      {error ? (
        <span role="alert" className="text-[12px] text-critical-text">
          {error}
        </span>
      ) : null}
    </div>
  );
}
