/**
 * Report structure summary for troubleshooting: the shape of each QuickBooks
 * report (columns, sections, groups and row labels) WITHOUT any amounts, so it
 * can be shared safely if a parsing issue needs to be diagnosed.
 */
import type { QboReport, QboRow } from "./parse-reports";

export interface ReportStructure {
  report: string;
  header: { reportName: string | null; startPeriod: string | null; endPeriod: string | null; currency: string | null };
  columns: { title: string; type: string; metaKeys: string[] }[];
  rows: { depth: number; type: string; group: string | null; label: string; hasHeader: boolean; hasSummary: boolean; childCount: number }[];
}

function walk(rows: QboRow[] | undefined, depth: number, out: ReportStructure["rows"]): void {
  for (const r of rows ?? []) {
    const label = (r.Header?.ColData?.[0]?.value ?? r.ColData?.[0]?.value ?? r.Summary?.ColData?.[0]?.value ?? "").slice(0, 120);
    out.push({ depth, type: r.type ?? (r.Rows ? "Section" : "Data"), group: r.group ?? null, label, hasHeader: Boolean(r.Header), hasSummary: Boolean(r.Summary), childCount: r.Rows?.Row?.length ?? 0 });
    walk(r.Rows?.Row, depth + 1, out);
    if (out.length > 2000) return;
  }
}

export function describeReport(name: string, report: QboReport): ReportStructure {
  const rows: ReportStructure["rows"] = [];
  walk(report.Rows?.Row, 0, rows);
  return {
    report: name,
    header: { reportName: report.Header?.ReportName ?? null, startPeriod: report.Header?.StartPeriod ?? null, endPeriod: report.Header?.EndPeriod ?? null, currency: report.Header?.Currency ?? null },
    columns: (report.Columns?.Column ?? []).map((c) => ({ title: c.ColTitle ?? "", type: c.ColType ?? "", metaKeys: (c.MetaData ?? []).map((m) => m.Name ?? "") })),
    rows,
  };
}
