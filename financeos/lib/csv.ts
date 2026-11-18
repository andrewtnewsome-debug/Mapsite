/**
 * CSV generation (RFC 4180 quoting) with protection against spreadsheet
 * formula injection: text cells that begin with = + - @ or a tab/CR are
 * prefixed with an apostrophe so Excel treats them as text.
 */

export type CsvCell = string | number | null | undefined;

function escapeCell(cell: CsvCell): string {
  if (cell == null) return "";
  if (typeof cell === "number") return Number.isFinite(cell) ? String(cell) : "";
  let s = String(cell);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(header: string[], rows: CsvCell[][], preamble: string[] = []): string {
  const lines = [...preamble.map((p) => escapeCell(p)), header.map(escapeCell).join(","), ...rows.map((r) => r.map(escapeCell).join(","))];
  // BOM so Excel on Windows opens UTF-8 correctly.
  return `﻿${lines.join("\r\n")}\r\n`;
}

export function csvFilename(base: string, asOf: string): string {
  return `${base.replace(/[^a-z0-9-]+/gi, "-").toLowerCase()}-${asOf}.csv`;
}
