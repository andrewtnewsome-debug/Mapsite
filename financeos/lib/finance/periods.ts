/** Reporting periods (month, fiscal quarter, fiscal year) and comparisons. */

import { addMonths, monthLabel, monthRange } from "@/lib/domain/dates";

export type PeriodGranularity = "month" | "quarter" | "year";

export interface Period {
  key: string;
  granularity: PeriodGranularity;
  label: string;
  startMonth: string;
  endMonth: string;
}

function monthNumber(month: string): number {
  return Number(month.slice(5, 7));
}

function yearNumber(month: string): number {
  return Number(month.slice(0, 4));
}

/** Months elapsed since the start of the fiscal year containing `month` (0-11). */
function fiscalOffset(month: string, fyStartMonth: number): number {
  return (monthNumber(month) - fyStartMonth + 12) % 12;
}

/** Fiscal year label: the calendar year in which the fiscal year ends. */
function fiscalYearOf(month: string, fyStartMonth: number): number {
  const start = addMonths(month, -fiscalOffset(month, fyStartMonth));
  return fyStartMonth === 1 ? yearNumber(start) : yearNumber(start) + 1;
}

export function periodContaining(month: string, granularity: PeriodGranularity, fyStartMonth = 1): Period {
  if (granularity === "month") {
    return { key: `M:${month}`, granularity, label: monthLabel(month, "long"), startMonth: month, endMonth: month };
  }
  const offset = fiscalOffset(month, fyStartMonth);
  const fy = fiscalYearOf(month, fyStartMonth);
  const fyLabel = fyStartMonth === 1 ? `${fy}` : `FY${fy}`;
  if (granularity === "quarter") {
    const q = Math.floor(offset / 3) + 1;
    const startMonth = addMonths(month, -(offset % 3));
    return {
      key: `Q:${fy}-${q}:${fyStartMonth}`,
      granularity,
      label: `Q${q} ${fyLabel}`,
      startMonth,
      endMonth: addMonths(startMonth, 2),
    };
  }
  const startMonth = addMonths(month, -offset);
  return {
    key: `Y:${fy}:${fyStartMonth}`,
    granularity,
    label: fyStartMonth === 1 ? `Year ${fy}` : `Fiscal ${fyLabel}`,
    startMonth,
    endMonth: addMonths(startMonth, 11),
  };
}

export function previousPeriod(period: Period, fyStartMonth = 1): Period {
  return periodContaining(addMonths(period.startMonth, -1), period.granularity, fyStartMonth);
}

export function samePeriodPriorYear(period: Period, fyStartMonth = 1): Period {
  return periodContaining(addMonths(period.startMonth, -12), period.granularity, fyStartMonth);
}

export function monthsInPeriod(period: Period): string[] {
  return monthRange(period.startMonth, period.endMonth);
}

/** Periods (newest first) that overlap the available months. */
export function availablePeriods(availableMonths: readonly string[], granularity: PeriodGranularity, fyStartMonth = 1): Period[] {
  const seen = new Map<string, Period>();
  for (const m of [...availableMonths].sort().reverse()) {
    const p = periodContaining(m, granularity, fyStartMonth);
    if (!seen.has(p.key)) seen.set(p.key, p);
  }
  return [...seen.values()];
}

export function parsePeriodKey(key: string): Period | null {
  const m = /^M:(\d{4}-\d{2})$/.exec(key);
  if (m) return periodContaining(m[1], "month");
  const q = /^Q:(\d{4})-([1-4]):(\d{1,2})$/.exec(key);
  if (q) {
    const fy = Number(q[1]);
    const quarter = Number(q[2]);
    const fyStart = Number(q[3]);
    if (fyStart < 1 || fyStart > 12) return null;
    const startYear = fyStart === 1 ? fy : fy - 1;
    const fyStartMonth = `${startYear}-${String(fyStart).padStart(2, "0")}`;
    return periodContaining(addMonths(fyStartMonth, (quarter - 1) * 3), "quarter", fyStart);
  }
  const y = /^Y:(\d{4}):(\d{1,2})$/.exec(key);
  if (y) {
    const fy = Number(y[1]);
    const fyStart = Number(y[2]);
    if (fyStart < 1 || fyStart > 12) return null;
    const startYear = fyStart === 1 ? fy : fy - 1;
    return periodContaining(`${startYear}-${String(fyStart).padStart(2, "0")}`, "year", fyStart);
  }
  return null;
}
