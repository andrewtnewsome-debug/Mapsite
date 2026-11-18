"use client";

import { usePathname, useRouter } from "next/navigation";
import { Segmented } from "@/components/ui/tabs";

export function BudgetPeriodPicker({ view }: { view: "month" | "quarter" | "ytd" }) {
  const router = useRouter();
  const pathname = usePathname();
  return (
    <Segmented
      label="Comparison period"
      value={view}
      onChange={(v) => router.push(`${pathname}?view=${v}`, { scroll: false })}
      options={[
        { value: "month", label: "Last month" },
        { value: "quarter", label: "Quarter" },
        { value: "ytd", label: "Year to date" },
      ]}
    />
  );
}
