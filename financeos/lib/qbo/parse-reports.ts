/**
 * Parsers for QuickBooks Online report JSON (ProfitAndLoss, BalanceSheet,
 * CashFlow, AgedReceivables). QuickBooks reports are nested trees:
 *   Rows.Row[] -> { type: "Section", group, Header, Rows, Summary } | { type: "Data", ColData }
 * Column metadata provides StartDate/EndDate per month when the report is
 * summarized by month. Leaves (Data rows) are mapped to canonical lines; the
 * nearest ancestor `group` decides the category. Summary rows are used only to
 * verify our totals.
 */

import type {
  BalanceSheetLine,
  BalanceSheetSection,
  BalanceSheetSnapshot,
  CashFlowLine,
  CashFlowSection,
  MonthlyCashFlow,
  MonthlyPnl,
  PnlCategory,
  PnlLine,
  SourceArAgingSummary,
} from "@/lib/domain/types";
import { isIsoDate, monthEnd, monthOf } from "@/lib/domain/dates";
import { parseAmount, roundCents, sum } from "@/lib/domain/money";

export interface QboColData {
  value?: string;
  id?: string;
}

export interface QboRow {
  type?: string;
  group?: string;
  ColData?: QboColData[];
  Header?: { ColData?: QboColData[] };
  Rows?: { Row?: QboRow[] };
  Summary?: { ColData?: QboColData[] };
}

export interface QboReport {
  Header?: { ReportName?: string; StartPeriod?: string; EndPeriod?: string; Currency?: string; Option?: { Name?: string; Value?: string }[] };
  Columns?: { Column?: { ColTitle?: string; ColType?: string; MetaData?: { Name?: string; Value?: string }[] }[] };
  Rows?: { Row?: QboRow[] };
}

export interface PeriodColumn {
  index: number;
  title: string;
  startDate: string | null;
  endDate: string | null;
}

/** Money columns that represent a period (excludes the account/label column and the "Total" column). */
export function periodColumns(report: QboReport): PeriodColumn[] {
  const cols = report.Columns?.Column ?? [];
  return cols
    .map((c, index) => {
      const meta = Object.fromEntries((c.MetaData ?? []).map((m) => [m.Name ?? "", m.Value ?? ""]));
      return { index, title: c.ColTitle ?? "", type: c.ColType ?? "", key: meta.ColKey ?? "", startDate: isIsoDate(meta.StartDate) ? meta.StartDate : null, endDate: isIsoDate(meta.EndDate) ? meta.EndDate : null };
    })
    .filter((c) => c.type === "Money" && c.key.toLowerCase() !== "total" && c.title.toLowerCase() !== "total")
    .map(({ index, title, startDate, endDate }) => ({ index, title, startDate, endDate }));
}

interface Leaf {
  label: string;
  values: (number | null)[];
  groups: string[];
}

/** Walk a report tree and collect data rows with their ancestor groups (outermost first). */
/** Values per column of a row's direct contribution (data row values, or a nested section's total). */
function addInto(acc: number[], values: (number | null)[]): void {
  values.forEach((v, i) => {
    if (i > 0 && v != null) acc[i] = (acc[i] ?? 0) + v;
  });
}

interface Collected {
  leaves: Leaf[];
  /** Column totals of everything collected at this level (for verifying section headers). */
  totals: number[];
}

function collect(rows: QboRow[] | undefined, groups: string[]): Collected {
  const leaves: Leaf[] = [];
  const totals: number[] = [];
  for (const row of rows ?? []) {
    const g = row.group ? [...groups, row.group] : groups;
    if (row.ColData && (row.type === "Data" || !row.Rows)) {
      const values = row.ColData.map((c) => parseAmount(c.value));
      leaves.push({ label: (row.ColData[0]?.value ?? "").trim(), values, groups: g });
      addInto(totals, values);
      continue;
    }
    const headerValues = row.Header?.ColData?.map((c) => parseAmount(c.value)) ?? [];
    const headerHasAmounts = headerValues.slice(1).some((v) => v != null && v !== 0);
    if (row.Rows?.Row?.length) {
      const inner = collect(row.Rows.Row, g);
      leaves.push(...inner.leaves);
      addInto(totals, inner.totals);
      if (headerHasAmounts) {
        // A parent account with its own postings shows them on its header line. Include a header
        // amount only where header + children equals QuickBooks' own section total for that column.
        const summary = row.Summary?.ColData?.map((c) => parseAmount(c.value)) ?? [];
        const own = headerValues.map((v, i) => {
          if (i === 0 || v == null) return null;
          const children = inner.totals[i] ?? 0;
          const total = summary[i];
          if (total == null) return null;
          return Math.abs(children + v - total) < 0.01 && Math.abs(children - total) >= 0.01 ? v : null;
        });
        if (own.some((v) => v != null)) {
          leaves.push({ label: (row.Header?.ColData?.[0]?.value ?? "").trim(), values: own, groups: g });
          addInto(totals, own);
        }
      }
    } else if (headerHasAmounts) {
      // A collapsed section whose header carries the amounts.
      leaves.push({ label: (row.Header?.ColData?.[0]?.value ?? "").trim(), values: headerValues, groups: g });
      addInto(totals, headerValues);
    }
  }
  return { leaves, totals };
}

/** Walk a report tree and collect data rows with their ancestor groups (outermost first). */
export function collectLeaves(rows: QboRow[] | undefined, groups: string[] = []): Leaf[] {
  return collect(rows, groups).leaves;
}

/** Find a Summary row by group anywhere in the tree. */
export function findSummary(rows: QboRow[] | undefined, group: string): (number | null)[] | null {
  for (const row of rows ?? []) {
    if (row.group === group && row.Summary?.ColData) return row.Summary.ColData.map((c) => parseAmount(c.value));
    const nested = findSummary(row.Rows?.Row, group);
    if (nested) return nested;
  }
  return null;
}

function findSummaryByLabel(rows: QboRow[] | undefined, pattern: RegExp): (number | null)[] | null {
  for (const row of rows ?? []) {
    const label = row.Summary?.ColData?.[0]?.value ?? row.ColData?.[0]?.value ?? "";
    if (pattern.test(label)) return (row.Summary?.ColData ?? row.ColData ?? []).map((c) => parseAmount(c.value));
    const nested = findSummaryByLabel(row.Rows?.Row, pattern);
    if (nested) return nested;
  }
  return null;
}

function columnMonth(c: PeriodColumn): string | null {
  return c.startDate ? monthOf(c.startDate) : c.endDate ? monthOf(c.endDate) : null;
}

/* ------------------------------------------------------------------ P&L */

const PNL_GROUPS: Record<string, PnlCategory> = {
  Income: "income",
  COGS: "cogs",
  Expenses: "expense",
  OtherIncome: "otherIncome",
  OtherExpenses: "otherExpense",
};

export function parseProfitAndLoss(report: QboReport, asOfDate: string): { months: MonthlyPnl[]; warnings: string[]; reportedNetIncome: Record<string, number> } {
  const warnings: string[] = [];
  const cols = periodColumns(report);
  const leaves = collectLeaves(report.Rows?.Row);
  const netIncome = findSummary(report.Rows?.Row, "NetIncome");
  const months: MonthlyPnl[] = [];
  const reportedNetIncome: Record<string, number> = {};
  for (const c of cols) {
    const month = columnMonth(c);
    if (!month) continue;
    const lines: PnlLine[] = [];
    for (const leaf of leaves) {
      const top = leaf.groups.find((g) => g in PNL_GROUPS);
      if (!top) continue;
      const amount = leaf.values[c.index];
      if (amount == null || amount === 0) continue;
      lines.push({ account: leaf.label || "Unnamed account", category: PNL_GROUPS[top], amount });
    }
    const endDate = c.endDate ?? monthEnd(month);
    months.push({ month, isPartial: endDate < monthEnd(month) && endDate >= asOfDate, endDate, lines });
    const reported = netIncome?.[c.index];
    if (reported != null) reportedNetIncome[month] = reported;
    if (reported != null) {
      const ours = roundCents(
        sum(lines.filter((l) => l.category === "income" || l.category === "otherIncome").map((l) => l.amount)) -
          sum(lines.filter((l) => l.category === "cogs" || l.category === "expense" || l.category === "otherExpense").map((l) => l.amount)),
      );
      if (Math.abs(ours - reported) > 1) warnings.push(`Profit and loss for ${month}: line items total ${ours} but QuickBooks reports net income of ${reported}.`);
    }
  }
  // Drop leading months with no activity (before the company started using QuickBooks).
  while (months.length && months[0].lines.length === 0) months.shift();
  const kept = new Set(months.map((m) => m.month));
  for (const m of Object.keys(reportedNetIncome)) if (!kept.has(m) && reportedNetIncome[m] === 0) delete reportedNetIncome[m];
  return { months, warnings, reportedNetIncome };
}

/* ------------------------------------------------------------------ Balance sheet */

const BS_GROUPS: Record<string, BalanceSheetSection> = {
  BankAccounts: "bank",
  AR: "accountsReceivable",
  OtherCurrentAssets: "otherCurrentAssets",
  FixedAssets: "fixedAssets",
  OtherAssets: "otherAssets",
  AP: "accountsPayable",
  CreditCards: "creditCards",
  OtherCurrentLiabilities: "otherCurrentLiabilities",
  LongTermLiabilities: "longTermLiabilities",
  Equity: "equity",
  // Fallbacks when a leaf sits directly under a parent group.
  CurrentAssets: "otherCurrentAssets",
  CurrentLiabilities: "otherCurrentLiabilities",
};

function bsSection(groups: string[]): BalanceSheetSection | null {
  for (let i = groups.length - 1; i >= 0; i--) if (groups[i] in BS_GROUPS) return BS_GROUPS[groups[i]];
  if (groups.includes("TotalAssets")) return "otherAssets";
  if (groups.includes("Liabilities")) return "otherCurrentLiabilities";
  return null;
}

export function parseBalanceSheet(report: QboReport): { snapshots: BalanceSheetSnapshot[]; warnings: string[]; reportedTotalAssets: Record<string, number> } {
  const warnings: string[] = [];
  const cols = periodColumns(report);
  const leaves = collectLeaves(report.Rows?.Row);
  const totalAssets = findSummary(report.Rows?.Row, "TotalAssets");
  const totalLE = findSummary(report.Rows?.Row, "TotalLiabilitiesAndEquity");
  const snapshots: BalanceSheetSnapshot[] = [];
  const reportedTotalAssets: Record<string, number> = {};
  const fallbackEnd = report.Header?.EndPeriod && isIsoDate(report.Header.EndPeriod) ? report.Header.EndPeriod : null;
  for (const c of cols) {
    const date = c.endDate ?? (cols.length === 1 ? fallbackEnd : null);
    if (!date) continue;
    const lines: BalanceSheetLine[] = [];
    for (const leaf of leaves) {
      const section = bsSection(leaf.groups);
      const amount = leaf.values[c.index];
      if (!section || amount == null || amount === 0) continue;
      lines.push({ section, account: leaf.label || "Unnamed account", amount });
    }
    const a = totalAssets?.[c.index];
    const le = totalLE?.[c.index];
    if (a != null) reportedTotalAssets[date] = a;
    if (a != null && le != null && Math.abs(a - le) > 1) warnings.push(`Balance sheet for ${date} does not balance in QuickBooks (assets ${a}, liabilities and equity ${le}).`);
    snapshots.push({ date, lines });
  }
  return { snapshots, warnings, reportedTotalAssets };
}

/* ------------------------------------------------------------------ Cash flow */

const CF_GROUPS: Record<string, CashFlowSection> = {
  OperatingActivities: "operating",
  InvestingActivities: "investing",
  FinancingActivities: "financing",
};

export function parseCashFlow(report: QboReport, asOfDate: string): { months: MonthlyCashFlow[]; warnings: string[] } {
  const warnings: string[] = [];
  const cols = periodColumns(report);
  const leaves = collectLeaves(report.Rows?.Row);
  const begin = findSummary(report.Rows?.Row, "BeginningCash") ?? findSummaryByLabel(report.Rows?.Row, /cash at beginning/i);
  const end = findSummary(report.Rows?.Row, "EndingCash") ?? findSummaryByLabel(report.Rows?.Row, /cash at end/i);
  const months: MonthlyCashFlow[] = [];
  for (const c of cols) {
    const month = columnMonth(c);
    if (!month) continue;
    const lines: CashFlowLine[] = [];
    for (const leaf of leaves) {
      const g = leaf.groups.find((x) => x in CF_GROUPS);
      const amount = leaf.values[c.index];
      if (!g || amount == null || amount === 0) continue;
      lines.push({ section: CF_GROUPS[g], label: leaf.label || "Other", amount });
    }
    const endDate = c.endDate ?? monthEnd(month);
    months.push({
      month,
      isPartial: endDate < monthEnd(month) && endDate >= asOfDate,
      endDate,
      lines,
      beginningCash: begin?.[c.index] ?? null,
      endingCash: end?.[c.index] ?? null,
    });
  }
  while (months.length && months[0].lines.length === 0 && !months[0].endingCash) months.shift();
  return { months, warnings };
}

/* ------------------------------------------------------------------ AR aging */

export function parseAgedReceivables(report: QboReport, asOfDate: string): SourceArAgingSummary | null {
  const cols = report.Columns?.Column ?? [];
  const idx = (re: RegExp) => cols.findIndex((c) => re.test((c.ColTitle ?? "").replace(/\s+/g, " ")));
  const iCurrent = idx(/^current$/i);
  const i1 = idx(/^1\s*-\s*30/);
  const i31 = idx(/^31\s*-\s*60/);
  const i61 = idx(/^61\s*-\s*90/);
  const i91 = idx(/^(91|over 90|90\+)/i);
  const iTotal = idx(/^total$/i);
  const totals = findSummary(report.Rows?.Row, "GrandTotal") ?? findSummaryByLabel(report.Rows?.Row, /^total$/i);
  if (!totals || iTotal < 0) return null;
  const pick = (i: number) => (i >= 0 ? (totals[i] ?? 0) : null);
  return { asOfDate, current: pick(iCurrent), days1to30: pick(i1), days31to60: pick(i31), days61to90: pick(i61), over90: pick(i91), total: pick(iTotal) };
}
