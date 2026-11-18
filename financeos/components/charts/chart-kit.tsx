"use client";

import * as React from "react";
import { formatCurrency, formatCurrencyCompact } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Shared chart styling. Colors are CSS variables so light/dark modes swap in one place. */
export const AXIS_TICK = { fill: "var(--chart-muted)", fontSize: 12 } as const;
export const AXIS_LINE = { stroke: "var(--chart-axis)" } as const;
export const GRID_STROKE = "var(--chart-grid)";
export const BAR_MAX = 24;

export function currencyTick(value: number): string {
  if (value === 0) return "$0";
  return formatCurrencyCompact(value);
}

export interface TooltipRow {
  label: string;
  value: string;
  color?: string;
  emphasis?: boolean;
}

/** Tooltip content shell used by every chart. Text uses ink tokens; color appears only in the key swatch. */
export function TooltipCard({ title, rows, footer }: { title: string; rows: TooltipRow[]; footer?: string }) {
  return (
    <div className="min-w-44 rounded-lg border border-border bg-surface px-3 py-2 shadow-pop">
      <p className="mb-1.5 text-[12px] font-medium text-text-2">{title}</p>
      <div className="space-y-1">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center justify-between gap-4 text-[12px]">
            <span className="flex items-center gap-1.5 text-text-2">
              {r.color ? <span aria-hidden className="inline-block size-2 rounded-[2px]" style={{ background: r.color }} /> : null}
              {r.label}
            </span>
            <span className={cn("tabular text-text", r.emphasis && "font-semibold")}>{r.value}</span>
          </div>
        ))}
      </div>
      {footer ? <p className="mt-1.5 border-t border-border pt-1.5 text-[11px] text-text-3">{footer}</p> : null}
    </div>
  );
}

export function money(v: unknown): string {
  return typeof v === "number" ? formatCurrency(v) : "Not available";
}

export function Legend({ items, className }: { items: { label: string; color: string; kind?: "bar" | "line" }[]; className?: string }) {
  return (
    <ul className={cn("flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-text-2", className)} aria-label="Legend">
      {items.map((i) => (
        <li key={i.label} className="flex items-center gap-1.5">
          <span aria-hidden className={cn("inline-block", i.kind === "line" ? "h-0.5 w-3 rounded-full" : "size-2.5 rounded-[3px]")} style={{ background: i.color }} />
          {i.label}
        </li>
      ))}
    </ul>
  );
}

/** Bar shape with a 4px rounded data end and a square baseline end, for positive and negative values. */
export function RoundedBar(props: { x?: number; y?: number; width?: number; height?: number; fill?: string; value?: number | number[] }) {
  const { x = 0, y = 0, width = 0, fill } = props;
  const height = props.height ?? 0;
  const raw = Array.isArray(props.value) ? props.value[1] - props.value[0] : props.value ?? 0;
  if (!width || !height) return null;
  const top = Math.min(y, y + height);
  const h = Math.abs(height);
  const r = Math.min(4, h, width / 2);
  const negative = raw < 0;
  const d = negative
    ? `M${x},${top} H${x + width} V${top + h - r} Q${x + width},${top + h} ${x + width - r},${top + h} H${x + r} Q${x},${top + h} ${x},${top + h - r} Z`
    : `M${x},${top + h} V${top + r} Q${x},${top} ${x + r},${top} H${x + width - r} Q${x + width},${top} ${x + width},${top + r} V${top + h} Z`;
  return <path d={d} fill={fill} />;
}

/** Collapsible accessible table view for a chart. */
export function ChartTable({ caption, columns, rows }: { caption: string; columns: string[]; rows: (string | number)[][] }) {
  return (
    <details className="group mt-3">
      <summary className="cursor-pointer select-none text-[12px] font-medium text-text-3 hover:text-text-2">View as table</summary>
      <div className="mt-2 max-h-72 overflow-auto rounded-lg border border-border">
        <table className="w-full text-[12px]">
          <caption className="sr-only">{caption}</caption>
          <thead className="sticky top-0 bg-surface-2">
            <tr>
              {columns.map((c, i) => (
                <th key={c} scope="col" className={cn("px-3 py-1.5 font-medium text-text-3", i === 0 ? "text-left" : "text-right")}>
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, ri) => (
              <tr key={ri} className="border-t border-border">
                {r.map((cell, ci) => (
                  <td key={ci} className={cn("px-3 py-1.5", ci === 0 ? "text-left text-text-2" : "tabular text-right text-text")}>
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

export function useMounted(): boolean {
  const [m, setM] = React.useState(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- render charts only after hydration to avoid SSR size mismatches
  React.useEffect(() => setM(true), []);
  return m;
}

export function ChartFrame({ height, children, label }: { height: number; children: React.ReactNode; label: string }) {
  const mounted = useMounted();
  return (
    <div role="img" aria-label={label} style={{ height }} className="w-full">
      {mounted ? children : <div className="h-full w-full animate-pulse rounded-lg bg-surface-2/60" />}
    </div>
  );
}
