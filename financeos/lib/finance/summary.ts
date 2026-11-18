/** One-click management summary, assembled entirely from deterministic calculations. */

import type { FinancialDataset } from "@/lib/domain/types";
import { formatIsoDate } from "@/lib/domain/dates";
import { DATA_SOURCE_LABELS } from "@/lib/domain/types";
import { formatCurrency, formatPercent, formatSignedPercent, NOT_AVAILABLE } from "@/lib/format";
import { generateInsights, type Insight, type InsightOptions } from "./insights";
import {
  cashPosition,
  lastClosedMonthComparison,
  payablesSnapshot,
  receivablesSnapshot,
  trailingTwelveMonths,
} from "./metrics";

export interface SummarySection {
  title: string;
  items: { label: string; value: string; note?: string }[];
}

export interface ManagementSummary {
  companyName: string;
  sourceLabel: string;
  asOfDate: string;
  generatedAt: string;
  sections: SummarySection[];
  notableChanges: Insight[];
  risks: Insight[];
}

export function buildManagementSummary(dataset: FinancialDataset, generatedAt = new Date().toISOString(), options: InsightOptions = {}): ManagementSummary {
  const month = lastClosedMonthComparison(dataset);
  const ttm = trailingTwelveMonths(dataset);
  const cash = cashPosition(dataset);
  const ar = receivablesSnapshot(dataset);
  const ap = payablesSnapshot(dataset);
  const insights = generateInsights(dataset, options);
  const monthName = month?.label ?? "Last closed month";

  const sections: SummarySection[] = [
    {
      title: "Revenue",
      items: [
        { label: `${monthName} revenue`, value: formatCurrency(month?.current.revenue), note: month?.revenueChange != null ? `${formatSignedPercent(month.revenueChange)} vs prior month` : undefined },
        { label: ttm ? `Trailing ${ttm.monthCount}-month revenue` : "Trailing 12-month revenue", value: formatCurrency(ttm?.revenue) },
      ],
    },
    {
      title: "Profitability",
      items: [
        { label: `${monthName} net income`, value: formatCurrency(month?.current.netIncome), note: month ? `Net margin ${formatPercent(month.current.netMargin)}` : undefined },
        { label: `${monthName} gross margin`, value: formatPercent(month?.current.grossMargin) },
        { label: "Trailing net income", value: formatCurrency(ttm?.netIncome), note: ttm ? `Net margin ${formatPercent(ttm.netMargin)}` : undefined },
      ],
    },
    {
      title: "Cash position",
      items: [
        { label: "Book cash balance", value: formatCurrency(cash?.amount), note: cash ? `As of ${formatIsoDate(cash.asOfDate)}. ${cash.caveat}` : NOT_AVAILABLE },
      ],
    },
    {
      title: "Accounts receivable",
      items: [
        { label: "Total receivables", value: formatCurrency(ar?.aging.total) },
        { label: "Overdue", value: formatCurrency(ar?.aging.overdueAmount), note: ar ? `${formatPercent(ar.aging.overdueShareOfBalance)} of receivables` : undefined },
        { label: "More than 60 days overdue", value: formatCurrency(ar?.aging.over60Amount) },
        { label: "Largest balance", value: ar && ar.customers[0] ? `${ar.customers[0].customerName}: ${formatCurrency(ar.customers[0].total)}` : NOT_AVAILABLE },
      ],
    },
    {
      title: "Accounts payable",
      items: [
        { label: "Total payables", value: formatCurrency(ap?.total) },
        { label: "Overdue", value: formatCurrency(ap?.overdue) },
        { label: "Due in the next 30 days", value: formatCurrency(ap?.dueNext30Days) },
      ],
    },
  ];

  return {
    companyName: dataset.company.name,
    sourceLabel: DATA_SOURCE_LABELS[dataset.source],
    asOfDate: dataset.asOfDate,
    generatedAt,
    sections,
    notableChanges: insights.filter((i) => i.category === "expenses" || i.category === "revenue" || i.category === "profitability"),
    risks: insights.filter((i) => i.severity === "concern" || i.severity === "watch"),
  };
}

export function managementSummaryToText(s: ManagementSummary): string {
  const lines: string[] = [];
  lines.push(`${s.companyName} - Management Summary`);
  lines.push(`Data source: ${s.sourceLabel}${s.sourceLabel === "Demo Company" ? " (fictional demonstration data)" : ""}`);
  lines.push(`As of ${formatIsoDate(s.asOfDate, "long")}`);
  lines.push("");
  for (const section of s.sections) {
    lines.push(section.title.toUpperCase());
    for (const item of section.items) lines.push(`- ${item.label}: ${item.value}${item.note ? ` (${item.note})` : ""}`);
    lines.push("");
  }
  lines.push("NOTABLE CHANGES");
  if (s.notableChanges.length === 0) lines.push("- None met the change thresholds.");
  for (const i of s.notableChanges) lines.push(`- ${i.title}`);
  lines.push("");
  lines.push("KEY FINANCIAL RISKS");
  if (s.risks.length === 0) lines.push("- No risk thresholds were triggered.");
  for (const i of s.risks) lines.push(`- ${i.title} [${i.severity}] - rule: ${i.trigger}`);
  lines.push("");
  lines.push("All figures are calculated deterministically by FinanceOS from the selected data source.");
  return lines.join("\n");
}
