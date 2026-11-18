"use client";

import * as React from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatCurrency, formatCurrencyCompact, formatPercent } from "@/lib/format";
import { AXIS_LINE, AXIS_TICK, BAR_MAX, ChartFrame, ChartTable, currencyTick, GRID_STROKE, Legend, RoundedBar, TooltipCard } from "./chart-kit";

type TipProps = { active?: boolean; payload?: ReadonlyArray<{ payload?: unknown }>; label?: unknown };

function tip<T>(render: (row: T) => React.ReactNode) {
  return function TooltipContent(props: TipProps) {
    const row = props.payload?.[0]?.payload;
    if (!props.active || row == null) return null;
    return <>{render(row as T)}</>;
  };
}

/* ------------------------------------------------------------------ cash balance history */

export interface CashPoint {
  label: string;
  endingCash: number | null;
}

export function CashHistoryChart({ data, height = 240 }: { data: CashPoint[]; height?: number }) {
  const last = data[data.length - 1];
  return (
    <>
      <ChartFrame height={height} label={`Month-end book cash balance. Latest ${last ? formatCurrency(last.endingCash) : "not available"}.`}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke={GRID_STROKE} />
            <XAxis dataKey="label" tick={AXIS_TICK} axisLine={AXIS_LINE} tickLine={false} interval="preserveStartEnd" minTickGap={24} />
            <YAxis tickFormatter={currencyTick} tick={AXIS_TICK} axisLine={false} tickLine={false} width={56} />
            <Tooltip
              cursor={{ stroke: "var(--chart-axis)", strokeWidth: 1 }}
              content={tip<CashPoint>((r) => <TooltipCard title={r.label} rows={[{ label: "Ending cash", value: formatCurrency(r.endingCash), color: "var(--series-1)" }]} />)}
            />
            <Area type="monotone" dataKey="endingCash" stroke="var(--series-1)" strokeWidth={2} fill="var(--series-1-wash)" fillOpacity={1} dot={false} activeDot={{ r: 4, stroke: "var(--chart-surface)", strokeWidth: 2, fill: "var(--series-1)" }} />
          </AreaChart>
        </ResponsiveContainer>
      </ChartFrame>
      <ChartTable caption="Month-end cash" columns={["Month", "Ending cash"]} rows={data.map((d) => [d.label, formatCurrency(d.endingCash)])} />
    </>
  );
}

/* ------------------------------------------------------------------ revenue vs expenses */

export interface RevExpPoint {
  label: string;
  revenue: number;
  totalExpenses: number;
  netIncome: number;
  isPartial?: boolean;
}

export function RevenueExpensesChart({ data, height = 260 }: { data: RevExpPoint[]; height?: number }) {
  return (
    <>
      <Legend
        className="mb-3"
        items={[
          { label: "Revenue", color: "var(--series-1)" },
          { label: "Total expenses", color: "var(--series-2)" },
        ]}
      />
      <ChartFrame height={height} label="Monthly revenue compared with total expenses">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barGap={2} barCategoryGap="28%">
            <CartesianGrid vertical={false} stroke={GRID_STROKE} />
            <XAxis dataKey="label" tick={AXIS_TICK} axisLine={AXIS_LINE} tickLine={false} interval="preserveStartEnd" minTickGap={16} />
            <YAxis tickFormatter={currencyTick} tick={AXIS_TICK} axisLine={false} tickLine={false} width={56} />
            <Tooltip
              cursor={{ fill: "var(--surface-2)" }}
              content={tip<RevExpPoint>((r) => (
                <TooltipCard
                  title={r.label}
                  rows={[
                    { label: "Revenue", value: formatCurrency(r.revenue), color: "var(--series-1)" },
                    { label: "Total expenses", value: formatCurrency(r.totalExpenses), color: "var(--series-2)" },
                    { label: "Net income", value: formatCurrency(r.netIncome), emphasis: true },
                  ]}
                  footer={r.isPartial ? "Month to date, not a full month" : undefined}
                />
              ))}
            />
            <Bar dataKey="revenue" fill="var(--series-1)" maxBarSize={BAR_MAX} shape={RoundedBar} />
            <Bar dataKey="totalExpenses" fill="var(--series-2)" maxBarSize={BAR_MAX} shape={RoundedBar} />
          </BarChart>
        </ResponsiveContainer>
      </ChartFrame>
      <ChartTable
        caption="Revenue, expenses and net income by month"
        columns={["Month", "Revenue", "Total expenses", "Net income"]}
        rows={data.map((d) => [d.label, formatCurrency(d.revenue), formatCurrency(d.totalExpenses), formatCurrency(d.netIncome)])}
      />
    </>
  );
}

/* ------------------------------------------------------------------ single-series signed bars (net income, net cash flow) */

export interface SignedPoint {
  label: string;
  value: number;
  note?: string;
}

export function SignedBarChart({ data, height = 220, seriesLabel }: { data: SignedPoint[]; height?: number; seriesLabel: string }) {
  return (
    <>
      <ChartFrame height={height} label={`${seriesLabel} by period`}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap="30%">
            <CartesianGrid vertical={false} stroke={GRID_STROKE} />
            <XAxis dataKey="label" tick={AXIS_TICK} axisLine={AXIS_LINE} tickLine={false} interval="preserveStartEnd" minTickGap={16} />
            <YAxis tickFormatter={currencyTick} tick={AXIS_TICK} axisLine={false} tickLine={false} width={56} />
            <ReferenceLine y={0} stroke="var(--chart-axis)" />
            <Tooltip
              cursor={{ fill: "var(--surface-2)" }}
              content={tip<SignedPoint>((r) => <TooltipCard title={r.label} rows={[{ label: seriesLabel, value: formatCurrency(r.value), color: "var(--series-1)" }]} footer={r.note} />)}
            />
            <Bar dataKey="value" fill="var(--series-1)" maxBarSize={BAR_MAX} shape={RoundedBar} />
          </BarChart>
        </ResponsiveContainer>
      </ChartFrame>
      <ChartTable caption={seriesLabel} columns={["Period", seriesLabel]} rows={data.map((d) => [d.label, formatCurrency(d.value)])} />
    </>
  );
}

/* ------------------------------------------------------------------ AR aging distribution */

export interface AgingPoint {
  label: string;
  amount: number;
  count: number;
  share: number | null;
}

const AGE_COLORS = ["var(--age-1)", "var(--age-2)", "var(--age-3)", "var(--age-4)", "var(--age-5)"];

export function AgingChart({ data, height = 240 }: { data: AgingPoint[]; height?: number }) {
  const rows = data.map((d, i) => ({ ...d, fill: AGE_COLORS[i] ?? "var(--age-5)" }));
  return (
    <>
      <ChartFrame height={height} label="Receivables by aging bucket, from current to more than 90 days overdue">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 22, right: 8, bottom: 0, left: 0 }} barCategoryGap="30%">
            <CartesianGrid vertical={false} stroke={GRID_STROKE} />
            <XAxis dataKey="label" tick={AXIS_TICK} axisLine={AXIS_LINE} tickLine={false} />
            <YAxis tickFormatter={currencyTick} tick={AXIS_TICK} axisLine={false} tickLine={false} width={56} />
            <Tooltip
              cursor={{ fill: "var(--surface-2)" }}
              content={tip<AgingPoint & { fill: string }>((r) => (
                <TooltipCard
                  title={r.label}
                  rows={[
                    { label: "Balance", value: formatCurrency(r.amount), color: r.fill },
                    { label: "Invoices", value: String(r.count) },
                    { label: "Share of AR", value: formatPercent(r.share) },
                  ]}
                />
              ))}
            />
            <Bar dataKey="amount" maxBarSize={48} shape={(p: React.ComponentProps<typeof RoundedBar> & { payload?: { fill: string } }) => <RoundedBar {...p} fill={p.payload?.fill} />}>
              <LabelList dataKey="amount" position="top" formatter={(v: unknown) => (typeof v === "number" ? formatCurrencyCompact(v) : "")} style={{ fill: "var(--text-2)", fontSize: 12 }} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </ChartFrame>
      <ChartTable caption="Aging distribution" columns={["Bucket", "Balance", "Invoices", "Share"]} rows={data.map((d) => [d.label, formatCurrency(d.amount), d.count, formatPercent(d.share)])} />
    </>
  );
}

/* ------------------------------------------------------------------ 13-week forecast scenarios */

export interface ForecastPoint {
  label: string;
  base: number;
  conservative: number;
  optimistic: number;
}

export function ForecastChart({ data, minimumCash, height = 300 }: { data: ForecastPoint[]; minimumCash: number | null; height?: number }) {
  return (
    <>
      <Legend
        className="mb-3"
        items={[
          { label: "Base", color: "var(--series-1)", kind: "line" },
          { label: "Conservative", color: "var(--series-2)", kind: "line" },
          { label: "Optimistic", color: "var(--series-3)", kind: "line" },
          ...(minimumCash != null ? [{ label: `Minimum cash ${formatCurrencyCompact(minimumCash)}`, color: "var(--critical)", kind: "line" as const }] : []),
        ]}
      />
      <ChartFrame height={height} label="Projected weekly ending cash under base, conservative and optimistic scenarios">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke={GRID_STROKE} />
            <XAxis dataKey="label" tick={AXIS_TICK} axisLine={AXIS_LINE} tickLine={false} interval="preserveStartEnd" minTickGap={12} />
            <YAxis tickFormatter={currencyTick} tick={AXIS_TICK} axisLine={false} tickLine={false} width={60} domain={["auto", "auto"]} />
            {minimumCash != null ? <ReferenceLine y={minimumCash} stroke="var(--critical)" strokeWidth={1} /> : null}
            <ReferenceLine y={0} stroke="var(--chart-axis)" />
            <Tooltip
              cursor={{ stroke: "var(--chart-axis)", strokeWidth: 1 }}
              content={tip<ForecastPoint>((r) => (
                <TooltipCard
                  title={`${r.label} (projected)`}
                  rows={[
                    { label: "Optimistic", value: formatCurrency(r.optimistic), color: "var(--series-3)" },
                    { label: "Base", value: formatCurrency(r.base), color: "var(--series-1)", emphasis: true },
                    { label: "Conservative", value: formatCurrency(r.conservative), color: "var(--series-2)" },
                  ]}
                  footer="Forecast, not actual results"
                />
              ))}
            />
            {(["optimistic", "base", "conservative"] as const).map((k) => (
              <Line
                key={k}
                type="monotone"
                dataKey={k}
                stroke={k === "base" ? "var(--series-1)" : k === "conservative" ? "var(--series-2)" : "var(--series-3)"}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                dot={false}
                activeDot={{ r: 4, stroke: "var(--chart-surface)", strokeWidth: 2 }}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </ChartFrame>
    </>
  );
}

/* ------------------------------------------------------------------ weekly or monthly inflows/outflows */

export interface FlowPoint {
  label: string;
  inflows: number;
  outflows: number;
  net?: number;
  note?: string;
}

export function FlowsChart({ data, height = 240, inflowLabel = "Cash in", outflowLabel = "Cash out" }: { data: FlowPoint[]; height?: number; inflowLabel?: string; outflowLabel?: string }) {
  return (
    <>
      <Legend
        className="mb-3"
        items={[
          { label: inflowLabel, color: "var(--series-1)" },
          { label: outflowLabel, color: "var(--series-2)" },
        ]}
      />
      <ChartFrame height={height} label={`${inflowLabel} compared with ${outflowLabel}`}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barGap={2} barCategoryGap="26%">
            <CartesianGrid vertical={false} stroke={GRID_STROKE} />
            <XAxis dataKey="label" tick={AXIS_TICK} axisLine={AXIS_LINE} tickLine={false} interval="preserveStartEnd" minTickGap={12} />
            <YAxis tickFormatter={currencyTick} tick={AXIS_TICK} axisLine={false} tickLine={false} width={56} />
            <Tooltip
              cursor={{ fill: "var(--surface-2)" }}
              content={tip<FlowPoint>((r) => (
                <TooltipCard
                  title={r.label}
                  rows={[
                    { label: inflowLabel, value: formatCurrency(r.inflows), color: "var(--series-1)" },
                    { label: outflowLabel, value: formatCurrency(r.outflows), color: "var(--series-2)" },
                    ...(r.net != null ? [{ label: "Net", value: formatCurrency(r.net), emphasis: true }] : []),
                  ]}
                  footer={r.note}
                />
              ))}
            />
            <Bar dataKey="inflows" fill="var(--series-1)" maxBarSize={BAR_MAX} shape={RoundedBar} />
            <Bar dataKey="outflows" fill="var(--series-2)" maxBarSize={BAR_MAX} shape={RoundedBar} />
          </BarChart>
        </ResponsiveContainer>
      </ChartFrame>
      <ChartTable
        caption={`${inflowLabel} and ${outflowLabel}`}
        columns={["Period", inflowLabel, outflowLabel, "Net"]}
        rows={data.map((d) => [d.label, formatCurrency(d.inflows), formatCurrency(d.outflows), formatCurrency(d.net ?? d.inflows - d.outflows)])}
      />
    </>
  );
}

/* ------------------------------------------------------------------ margins over time */

export interface MarginPoint {
  label: string;
  grossMargin: number | null;
  netMargin: number | null;
}

export function MarginChart({ data, height = 240 }: { data: MarginPoint[]; height?: number }) {
  return (
    <>
      <Legend
        className="mb-3"
        items={[
          { label: "Gross margin", color: "var(--series-1)", kind: "line" },
          { label: "Net margin", color: "var(--series-2)", kind: "line" },
        ]}
      />
      <ChartFrame height={height} label="Gross and net margin by month">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke={GRID_STROKE} />
            <XAxis dataKey="label" tick={AXIS_TICK} axisLine={AXIS_LINE} tickLine={false} interval="preserveStartEnd" minTickGap={16} />
            <YAxis tickFormatter={(v: number) => `${Math.round(v * 100)}%`} tick={AXIS_TICK} axisLine={false} tickLine={false} width={44} />
            <ReferenceLine y={0} stroke="var(--chart-axis)" />
            <Tooltip
              cursor={{ stroke: "var(--chart-axis)", strokeWidth: 1 }}
              content={tip<MarginPoint>((r) => (
                <TooltipCard
                  title={r.label}
                  rows={[
                    { label: "Gross margin", value: formatPercent(r.grossMargin), color: "var(--series-1)" },
                    { label: "Net margin", value: formatPercent(r.netMargin), color: "var(--series-2)" },
                  ]}
                />
              ))}
            />
            <Line type="monotone" dataKey="grossMargin" stroke="var(--series-1)" strokeWidth={2} dot={false} connectNulls={false} activeDot={{ r: 4, stroke: "var(--chart-surface)", strokeWidth: 2 }} />
            <Line type="monotone" dataKey="netMargin" stroke="var(--series-2)" strokeWidth={2} dot={false} connectNulls={false} activeDot={{ r: 4, stroke: "var(--chart-surface)", strokeWidth: 2 }} />
          </LineChart>
        </ResponsiveContainer>
      </ChartFrame>
      <ChartTable caption="Margins by month" columns={["Month", "Gross margin", "Net margin"]} rows={data.map((d) => [d.label, formatPercent(d.grossMargin), formatPercent(d.netMargin)])} />
    </>
  );
}

/* ------------------------------------------------------------------ horizontal ranked bars */

export interface RankedPoint {
  label: string;
  value: number;
  detail?: string;
}

export function RankedBars({ data, valueLabel }: { data: RankedPoint[]; valueLabel: string }) {
  const max = Math.max(1, ...data.map((d) => Math.abs(d.value)));
  return (
    <ul className="space-y-3">
      {data.map((d) => (
        <li key={d.label}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-[13px]">
            <span className="truncate text-text">{d.label}</span>
            <span className="tabular shrink-0 font-medium text-text">{formatCurrency(d.value)}</span>
          </div>
          <div className="h-2 w-full rounded-full bg-surface-2" role="presentation">
            <div className="h-2 rounded-full bg-series-1" style={{ width: `${Math.max(2, (Math.abs(d.value) / max) * 100)}%` }} />
          </div>
          {d.detail ? <p className="mt-1 text-[12px] text-text-3">{d.detail}</p> : null}
        </li>
      ))}
      <li className="sr-only">Values are {valueLabel}.</li>
    </ul>
  );
}
