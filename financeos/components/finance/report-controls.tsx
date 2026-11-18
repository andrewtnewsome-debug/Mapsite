"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { Period, PeriodGranularity } from "@/lib/finance/periods";
import { Select } from "@/components/ui/input";
import { Segmented } from "@/components/ui/tabs";
import { Spinner } from "@/components/ui/spinner";

export function ReportControls({
  report,
  granularity,
  periodKey,
  compare,
  periods,
  showPeriod,
}: {
  report: string;
  granularity: PeriodGranularity;
  periodKey: string;
  compare: string;
  periods: Period[];
  showPeriod: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, start] = React.useTransition();

  function go(patch: Record<string, string | null>) {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v == null) next.delete(k);
      else next.set(k, v);
    }
    start(() => router.push(`${pathname}?${next.toString()}`, { scroll: false }));
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Segmented
        label="Report"
        value={report}
        onChange={(v) => go({ report: v })}
        options={[
          { value: "pnl", label: "Profit & Loss" },
          { value: "balance-sheet", label: "Balance Sheet" },
          { value: "cash-flow", label: "Cash Flow" },
          { value: "ar-aging", label: "AR Aging" },
          { value: "ratios", label: "Ratios" },
        ]}
      />
      {showPeriod ? (
        <>
          <Segmented
            label="Period type"
            value={granularity}
            onChange={(v) => go({ g: v, period: null })}
            options={[
              { value: "month", label: "Monthly" },
              { value: "quarter", label: "Quarterly" },
              { value: "year", label: "Annual" },
            ]}
          />
          <label htmlFor="period" className="sr-only">Period</label>
          <Select id="period" className="h-8 w-auto text-[13px]" value={periodKey} onChange={(e) => go({ period: e.target.value })}>
            {periods.map((p) => (
              <option key={p.key} value={p.key}>{p.label}</option>
            ))}
          </Select>
          <label htmlFor="compare" className="sr-only">Compare with</label>
          <Select id="compare" className="h-8 w-auto text-[13px]" value={compare} onChange={(e) => go({ compare: e.target.value })}>
            <option value="prior-period">vs prior period</option>
            <option value="prior-year">vs same period last year</option>
            <option value="none">No comparison</option>
          </Select>
        </>
      ) : null}
      {pending ? <Spinner label="Updating report" /> : null}
    </div>
  );
}
