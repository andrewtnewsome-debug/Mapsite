"use client";

import * as React from "react";
import { AlertTriangle, Download, Plus, RotateCcw, Save, Trash2 } from "lucide-react";
import type { FinancialDataset } from "@/lib/domain/types";
import { formatIsoDate } from "@/lib/domain/dates";
import {
  FORECAST_WEEKS,
  runAllScenarios,
  SCENARIOS,
  type AssumptionSource,
  type ForecastAssumptions,
  type ForecastResult,
  type ForecastWarning,
  type OneTimeItem,
  type ScenarioId,
} from "@/lib/finance/forecast";
import { ForecastAssumptionsSchema } from "@/lib/finance/forecast-schema";
import { toCsv } from "@/lib/csv";
import { formatCurrency, formatCurrencyCompact } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ForecastChart } from "@/components/charts/charts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { Notice } from "@/components/ui/states";
import { Segmented } from "@/components/ui/tabs";
import { InfoTip } from "@/components/ui/tooltip";

type NumericField = Exclude<keyof ForecastAssumptions, "oneTimeItems" | "payrollFrequency" | "minimumCashBalance">;

interface FieldSpec {
  field: NumericField | "minimumCashBalance";
  label: string;
  unit: "currency" | "percent" | "days";
  hint: string;
}

const GROUPS: { title: string; fields: FieldSpec[] }[] = [
  {
    title: "Collections",
    fields: [
      { field: "collectionRate", label: "Expected collection rate", unit: "percent", hint: "Share of open receivables you expect to collect." },
      { field: "collectionDelayDays", label: "Collection delay", unit: "days", hint: "Days after the due date customers pay." },
      { field: "weeklyNewBillings", label: "New billings per week", unit: "currency", hint: "Invoices you expect to issue each week." },
      { field: "newBillingsCollectionDays", label: "Days to collect new billings", unit: "days", hint: "From invoice date to cash received." },
    ],
  },
  {
    title: "Payments",
    fields: [
      { field: "weeklyPayroll", label: "Payroll per week", unit: "currency", hint: "Gross payroll plus employer taxes and benefits." },
      { field: "weeklyRecurringExpenses", label: "Recurring operating expenses per week", unit: "currency", hint: "Rent, insurance, fuel, software and other costs paid directly." },
      { field: "vendorCostPctOfBillings", label: "Vendor costs for new work", unit: "percent", hint: "Materials and subcontractors, as a share of new billings." },
      { field: "vendorPaymentDays", label: "Days to pay new vendor costs", unit: "days", hint: "From billing to paying the related vendor bills." },
      { field: "billPaymentDelayDays", label: "Open bill payment delay", unit: "days", hint: "Days after due date you pay existing bills." },
      { field: "weeklyDebtService", label: "Debt service per week", unit: "currency", hint: "Loan principal and interest." },
      { field: "minimumCashBalance", label: "Minimum cash balance", unit: "currency", hint: "Warn when projected cash falls below this." },
    ],
  },
];

const BASIS_LABEL: Record<AssumptionSource["basis"], { label: string; tone: "accent" | "neutral" | "warning" }> = {
  "accounting-data": { label: "From data", tone: "accent" },
  "management-input": { label: "Management input", tone: "neutral" },
  fallback: { label: "Assumption", tone: "warning" },
};

function toDisplay(value: number | null, unit: FieldSpec["unit"]): string {
  if (value == null) return "";
  if (unit === "percent") return String(Math.round(value * 1000) / 10);
  return String(Math.round(value));
}

function fromDisplay(text: string, unit: FieldSpec["unit"]): number | null {
  if (text.trim() === "") return null;
  const n = Number(text.replace(/[,$%\s]/g, ""));
  if (!Number.isFinite(n)) return null;
  if (unit === "percent") return Math.min(1, Math.max(0, n / 100));
  if (unit === "days") return Math.max(0, Math.round(n));
  return Math.max(0, n);
}

let idCounter = 0;
const newId = () => `item-${Date.now().toString(36)}-${(idCounter++).toString(36)}`;

export function ForecastTool({
  dataset,
  defaults,
  saved,
  sources,
  defaultWarnings,
  dataWarnings,
}: {
  dataset: FinancialDataset;
  defaults: ForecastAssumptions;
  saved: { savedAt: string; assumptions: ForecastAssumptions } | null;
  sources: AssumptionSource[];
  defaultWarnings: string[];
  dataWarnings: ForecastWarning[];
}) {
  const [assumptions, setAssumptions] = React.useState<ForecastAssumptions>(saved?.assumptions ?? defaults);
  const [drafts, setDrafts] = React.useState<Record<string, string>>({});
  const [scenario, setScenario] = React.useState<ScenarioId>("base");
  const [savedAt, setSavedAt] = React.useState<string | null>(saved?.savedAt ?? null);
  const [saveState, setSaveState] = React.useState<"idle" | "saving" | "error">("idle");
  const [newItem, setNewItem] = React.useState<{ label: string; week: number; amount: string; direction: OneTimeItem["direction"] }>({ label: "", week: 1, amount: "", direction: "outflow" });

  const results = React.useMemo(() => runAllScenarios(dataset, assumptions), [dataset, assumptions]);
  const sourceFor = (field: string) => sources.find((s) => s.field === field);
  const dirty = JSON.stringify(assumptions) !== JSON.stringify(saved?.assumptions ?? defaults);

  function update(field: FieldSpec["field"], value: number | null) {
    setAssumptions((a) => ({ ...a, [field]: field === "minimumCashBalance" ? value : (value ?? 0) }));
  }

  async function save() {
    setSaveState("saving");
    const res = await fetch("/api/forecast/assumptions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(assumptions) });
    if (!res.ok) return setSaveState("error");
    const body = (await res.json()) as { savedAt: string };
    setSavedAt(body.savedAt);
    setSaveState("idle");
  }

  async function resetToDefaults() {
    setAssumptions(defaults);
    setDrafts({});
    if (savedAt) {
      await fetch("/api/forecast/assumptions", { method: "DELETE" });
      setSavedAt(null);
    }
  }

  function addItem() {
    const amount = Number(newItem.amount.replace(/[,$\s]/g, ""));
    if (!newItem.label.trim() || !(amount > 0)) return;
    const item: OneTimeItem = { id: newId(), label: newItem.label.trim().slice(0, 80), week: newItem.week, amount, direction: newItem.direction };
    const next = { ...assumptions, oneTimeItems: [...assumptions.oneTimeItems, item] };
    if (ForecastAssumptionsSchema.safeParse(next).success) {
      setAssumptions(next);
      setNewItem({ label: "", week: 1, amount: "", direction: "outflow" });
    }
  }

  function exportCsv() {
    if (!results) return;
    const r = results[scenario];
    const header = ["Line", ...r.weeks.map((w) => `Week ${w.week} (${w.endDate})`), "13-week total"];
    const line = (label: string, pick: (w: ForecastResult["weeks"][number]) => number, total = true) => [label, ...r.weeks.map(pick), total ? r.weeks.reduce((s, w) => s + pick(w), 0) : ""];
    const rows = [
      line("Beginning cash", (w) => w.beginningCash, false),
      line("Collections - open invoices", (w) => w.collectionsOpenAr),
      line("Collections - new billings", (w) => w.collectionsNewBillings),
      line("One-time inflows", (w) => w.oneTimeInflows),
      line("Total inflows", (w) => w.totalInflows),
      line("Vendor payments - open bills", (w) => w.vendorPaymentsOpenBills),
      line("Vendor payments - new work", (w) => w.vendorPaymentsNewWork),
      line("Payroll", (w) => w.payroll),
      line("Recurring operating expenses", (w) => w.recurringExpenses),
      line("Debt service", (w) => w.debtService),
      line("One-time outflows", (w) => w.oneTimeOutflows),
      line("Total outflows", (w) => w.totalOutflows),
      line("Net cash flow", (w) => w.netCashFlow),
      line("Ending cash (projected)", (w) => w.endingCash, false),
    ].map((row) => row.map((v) => (typeof v === "number" ? Math.round(v * 100) / 100 : v)));
    const csv = toCsv(header, rows, [
      `${dataset.company.name} - 13-week cash flow forecast (${SCENARIOS[scenario].label} scenario)`,
      `Data source: ${dataset.source === "demo" ? "Demo Company (FICTIONAL DEMONSTRATION DATA)" : "QuickBooks Sandbox"}`,
      `Starting book cash as of ${dataset.asOfDate}. All weekly figures are projections based on stated assumptions, not actual results.`,
      "",
    ]);
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${dataset.source === "demo" ? "demo" : "qbo-sandbox"}-13-week-forecast-${scenario}-${dataset.asOfDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (!results) {
    return (
      <Card>
        <CardContent className="pt-5">
          <Notice tone="critical" title="A forecast cannot be produced">
            {dataWarnings.map((w) => w.message).join(" ") || "Starting cash is not available."}
          </Notice>
        </CardContent>
      </Card>
    );
  }

  const r = results[scenario];
  const chartData = results.base.weeks.map((w, i) => ({
    label: `Wk ${w.week}`,
    base: w.endingCash,
    conservative: results.conservative.weeks[i].endingCash,
    optimistic: results.optimistic.weeks[i].endingCash,
  }));
  const min = assumptions.minimumCashBalance;

  return (
    <div className="space-y-4">
      {dataWarnings.length > 0 || defaultWarnings.length > 0 ? (
        <Notice tone="warning" title="Forecast reliability notes">
          <ul className="list-disc space-y-0.5 pl-5">
            {dataWarnings.map((w) => (
              <li key={w.message}>{w.message}</li>
            ))}
            {defaultWarnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </Notice>
      ) : null}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {(["conservative", "base", "optimistic"] as const).map((id) => {
          const res = results[id];
          const breach = res.weeksBelowZero.length > 0 ? "critical" : res.weeksBelowMinimum.length > 0 ? "warning" : null;
          return (
            <button
              key={id}
              type="button"
              onClick={() => setScenario(id)}
              aria-pressed={scenario === id}
              className={cn("rounded-xl border bg-surface p-4 text-left shadow-card transition-colors", scenario === id ? "border-text ring-1 ring-text" : "border-border hover:border-border-strong")}
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-[13px] font-medium text-text-2">{SCENARIOS[id].label} scenario</p>
                {breach ? (
                  <Badge tone={breach}>
                    <AlertTriangle aria-hidden /> {breach === "critical" ? "Below zero" : "Below minimum"}
                  </Badge>
                ) : (
                  <Badge tone="good">Above minimum</Badge>
                )}
              </div>
              <p className="mt-2 text-[24px] font-semibold leading-8 tracking-tight">{formatCurrency(res.endingCash)}</p>
              <p className="text-[12px] text-text-3">Projected cash at week 13 ({formatIsoDate(res.weeks[FORECAST_WEEKS - 1].endDate)})</p>
              <p className="mt-2 text-[12px] text-text-2">
                Lowest: <span className="tabular font-medium">{formatCurrency(res.lowestCash.amount)}</span> in week {res.lowestCash.week}
                {res.weeksBelowMinimum.length ? ` · ${res.weeksBelowMinimum.length} week(s) below minimum` : ""}
              </p>
            </button>
          );
        })}
      </div>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Projected cash balance: scenario comparison</CardTitle>
            <CardDescription>
              Forecast starting from book cash of {formatCurrency(r.startingCash)} on {formatIsoDate(dataset.asOfDate)}. Projections, not actual results.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <ForecastChart data={chartData} minimumCash={min} />
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-1">
          <CardHeader>
            <div>
              <CardTitle>Assumptions</CardTitle>
              <CardDescription>Base case inputs. Scenarios adjust these automatically.</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            {GROUPS.map((g) => (
              <fieldset key={g.title} className="space-y-3">
                <legend className="mb-2 text-[12px] font-semibold uppercase tracking-wider text-text-3">{g.title}</legend>
                {g.fields.map((f) => {
                  const src = sourceFor(f.field);
                  const id = `fa-${f.field}`;
                  const value = assumptions[f.field] as number | null;
                  return (
                    <div key={f.field}>
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <label htmlFor={id} className="text-[13px] font-medium text-text-2">
                          {f.label}
                        </label>
                        {src ? (
                          <span className="flex items-center gap-1">
                            <Badge tone={BASIS_LABEL[src.basis].tone}>{BASIS_LABEL[src.basis].label}</Badge>
                            <InfoTip content={src.explanation} label={`How ${f.label} was set`} />
                          </span>
                        ) : null}
                      </div>
                      <div className="relative">
                        {f.unit === "currency" ? <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-text-3">$</span> : null}
                        <Input
                          id={id}
                          inputMode="decimal"
                          className={cn("tabular", f.unit === "currency" && "pl-6", f.unit !== "currency" && "pr-12")}
                          value={drafts[f.field] ?? toDisplay(value, f.unit)}
                          onChange={(e) => setDrafts((d) => ({ ...d, [f.field]: e.target.value }))}
                          onBlur={(e) => {
                            const v = fromDisplay(e.target.value, f.unit);
                            update(f.field, v);
                            setDrafts((d) => {
                              const next = { ...d };
                              delete next[f.field];
                              return next;
                            });
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                          }}
                          aria-describedby={`${id}-hint`}
                        />
                        {f.unit !== "currency" ? <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[12px] text-text-3">{f.unit === "percent" ? "%" : "days"}</span> : null}
                      </div>
                      <p id={`${id}-hint`} className="mt-1 text-[12px] text-text-3">
                        {f.hint}
                      </p>
                      {f.field === "weeklyPayroll" ? (
                        <div className="mt-2 flex items-center gap-2">
                          <span className="text-[12px] text-text-3">Paid</span>
                          <Segmented
                            label="Payroll frequency"
                            value={assumptions.payrollFrequency}
                            onChange={(v) => setAssumptions((a) => ({ ...a, payrollFrequency: v }))}
                            options={[
                              { value: "weekly", label: "Weekly" },
                              { value: "biweekly", label: "Every 2 weeks" },
                            ]}
                          />
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </fieldset>
            ))}
            <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
              <Button variant="primary" size="sm" onClick={save} disabled={saveState === "saving" || !dirty}>
                <Save /> {saveState === "saving" ? "Saving…" : "Save assumptions"}
              </Button>
              <Button size="sm" variant="ghost" onClick={resetToDefaults}>
                <RotateCcw /> Reset to defaults
              </Button>
              <p className="w-full text-[12px] text-text-3" aria-live="polite">
                {saveState === "error" ? <span className="text-critical-text">Could not save. Check the values and try again.</span> : savedAt ? `Saved on this computer ${new Date(savedAt).toLocaleString()}` : "Using defaults derived from your data."}
                {dirty ? " · Unsaved changes" : ""}
              </p>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4 xl:col-span-2">
          <Card>
            <CardHeader>
              <div>
                <CardTitle>One-time cash items</CardTitle>
                <CardDescription>Owner distributions, tax payments, equipment purchases, loan proceeds, asset sales</CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              <form
                className="grid grid-cols-2 gap-2 sm:grid-cols-[1fr_110px_120px_130px_auto]"
                onSubmit={(e) => {
                  e.preventDefault();
                  addItem();
                }}
              >
                <div className="col-span-2 sm:col-span-1">
                  <label htmlFor="oti-label" className="sr-only">Description</label>
                  <Input id="oti-label" placeholder="Description, e.g. Quarterly tax payment" value={newItem.label} maxLength={80} onChange={(e) => setNewItem((n) => ({ ...n, label: e.target.value }))} />
                </div>
                <div>
                  <label htmlFor="oti-dir" className="sr-only">Direction</label>
                  <Select id="oti-dir" value={newItem.direction} onChange={(e) => setNewItem((n) => ({ ...n, direction: e.target.value as OneTimeItem["direction"] }))}>
                    <option value="outflow">Outflow</option>
                    <option value="inflow">Inflow</option>
                  </Select>
                </div>
                <div>
                  <label htmlFor="oti-week" className="sr-only">Week</label>
                  <Select id="oti-week" value={newItem.week} onChange={(e) => setNewItem((n) => ({ ...n, week: Number(e.target.value) }))}>
                    {results.base.weeks.map((w) => (
                      <option key={w.week} value={w.week}>
                        Week {w.week} · {formatIsoDate(w.endDate).replace(/, \d{4}$/, "")}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="relative">
                  <label htmlFor="oti-amount" className="sr-only">Amount</label>
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-text-3">$</span>
                  <Input id="oti-amount" inputMode="decimal" className="pl-6" placeholder="Amount" value={newItem.amount} onChange={(e) => setNewItem((n) => ({ ...n, amount: e.target.value }))} />
                </div>
                <Button type="submit" size="md">
                  <Plus /> Add
                </Button>
              </form>
              {assumptions.oneTimeItems.length === 0 ? (
                <p className="mt-3 text-[13px] text-text-3">No one-time items. Add known large payments or receipts to make the forecast more realistic.</p>
              ) : (
                <ul className="mt-3 divide-y divide-border rounded-lg border border-border">
                  {assumptions.oneTimeItems.map((item) => (
                    <li key={item.id} className="flex items-center gap-3 px-3 py-2 text-[13px]">
                      <Badge tone={item.direction === "inflow" ? "good" : "serious"}>{item.direction === "inflow" ? "In" : "Out"}</Badge>
                      <span className="min-w-0 flex-1 truncate">{item.label}</span>
                      <span className="text-text-3">Week {item.week}</span>
                      <span className="tabular w-28 text-right font-medium">{formatCurrency(item.amount)}</span>
                      <button
                        type="button"
                        className="inline-flex size-7 items-center justify-center rounded-md text-text-3 hover:bg-surface-2 hover:text-critical-text"
                        aria-label={`Remove ${item.label}`}
                        onClick={() => setAssumptions((a) => ({ ...a, oneTimeItems: a.oneTimeItems.filter((x) => x.id !== item.id) }))}
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div>
                <CardTitle>Weekly detail</CardTitle>
                <CardDescription>{SCENARIOS[scenario].description}</CardDescription>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Segmented
                  label="Scenario"
                  value={scenario}
                  onChange={setScenario}
                  options={[
                    { value: "conservative", label: "Conservative" },
                    { value: "base", label: "Base" },
                    { value: "optimistic", label: "Optimistic" },
                  ]}
                />
                <Button size="sm" onClick={exportCsv}>
                  <Download /> CSV
                </Button>
              </div>
            </CardHeader>
            <CardContent className="px-0">
              <WeeklyTable result={r} minimum={min} />
              <div className="mt-3 space-y-1 px-5 text-[12px] text-text-3">
                <p>
                  Open receivables expected after week 13: {formatCurrency(r.openArBeyondHorizon)}. Not expected to be collected under this scenario: {formatCurrency(r.openArNotExpected)}. Open bills due after week 13: {formatCurrency(r.openBillsBeyondHorizon)}.
                </p>
                <p>Collectability by aging (on top of the collection rate): {Object.entries(SCENARIOS[scenario].collectability).map(([k, v]) => `${k === "current" ? "current" : `${k} days`} ${Math.round(v * 100)}%`).join(", ")}.</p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function WeeklyTable({ result, minimum }: { result: ForecastResult; minimum: number | null }) {
  const lines: { label: string; pick: (w: ForecastResult["weeks"][number]) => number; kind?: "total" | "balance" | "sub"; sign?: -1 }[] = [
    { label: "Beginning cash", pick: (w) => w.beginningCash, kind: "balance" },
    { label: "Collections, open invoices", pick: (w) => w.collectionsOpenAr, kind: "sub" },
    { label: "Collections, new billings", pick: (w) => w.collectionsNewBillings, kind: "sub" },
    { label: "One-time inflows", pick: (w) => w.oneTimeInflows, kind: "sub" },
    { label: "Total inflows", pick: (w) => w.totalInflows, kind: "total" },
    { label: "Vendor payments, open bills", pick: (w) => w.vendorPaymentsOpenBills, kind: "sub", sign: -1 },
    { label: "Vendor payments, new work", pick: (w) => w.vendorPaymentsNewWork, kind: "sub", sign: -1 },
    { label: "Payroll", pick: (w) => w.payroll, kind: "sub", sign: -1 },
    { label: "Recurring operating expenses", pick: (w) => w.recurringExpenses, kind: "sub", sign: -1 },
    { label: "Debt service", pick: (w) => w.debtService, kind: "sub", sign: -1 },
    { label: "One-time outflows", pick: (w) => w.oneTimeOutflows, kind: "sub", sign: -1 },
    { label: "Total outflows", pick: (w) => w.totalOutflows, kind: "total", sign: -1 },
    { label: "Net cash flow", pick: (w) => w.netCashFlow, kind: "total" },
    { label: "Ending cash", pick: (w) => w.endingCash, kind: "balance" },
  ];
  return (
    <div tabIndex={0} role="region" aria-label="Weekly projected cash flow table" className="overflow-x-auto border-y border-border">
      <table className="w-full min-w-[1100px] text-[12px]">
        <caption className="sr-only">Weekly projected cash flow</caption>
        <thead>
          <tr className="border-b border-border bg-surface-2/60">
            <th scope="col" className="sticky left-0 z-10 bg-surface-2 px-4 py-2 text-left font-medium text-text-3">
              Projected
            </th>
            {result.weeks.map((w) => (
              <th key={w.week} scope="col" className="px-2 py-2 text-right font-medium text-text-3">
                <div>Wk {w.week}</div>
                <div className="font-normal">{formatIsoDate(w.endDate).replace(/, \d{4}$/, "")}</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.label} className={cn("border-b border-border last:border-0", l.kind === "total" && "bg-surface-2/40", l.kind === "balance" && "font-semibold")}>
              <th scope="row" className={cn("sticky left-0 z-10 whitespace-nowrap bg-surface px-4 py-1.5 text-left font-normal text-text-2", l.kind !== "sub" && "font-medium text-text", l.kind === "sub" && "pl-7")}>
                {l.label}
              </th>
              {result.weeks.map((w) => {
                const v = l.pick(w);
                const low = l.label === "Ending cash" && minimum != null && v < minimum;
                return (
                  <td key={w.week} className={cn("tabular whitespace-nowrap px-2 py-1.5 text-right", v === 0 && l.kind === "sub" ? "text-text-3" : "text-text", low && "text-critical-text")}>
                    {v === 0 && l.kind === "sub" ? "—" : l.sign === -1 ? `(${formatCurrencyCompact(Math.abs(v))})` : formatCurrencyCompact(v).replace("-", "−")}
                    {low ? <span className="sr-only"> (below minimum)</span> : null}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
