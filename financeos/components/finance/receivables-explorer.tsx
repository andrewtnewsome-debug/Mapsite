"use client";

import * as React from "react";
import { Download, RotateCcw } from "lucide-react";
import type { OpenInvoice } from "@/lib/finance/aging";
import { AGING_BUCKETS } from "@/lib/finance/aging";
import { applyArFilters, type ArFilters } from "@/lib/finance/ar-filters";
import { formatIsoDate } from "@/lib/domain/dates";
import { formatCurrency } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Table, TableWrap, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/states";

type SortKey = "daysOverdue" | "balance" | "dueDate" | "customer";

const DEFAULT: ArFilters = { bucket: "all", status: "all" };

export function ReceivablesExplorer({ invoices, customers, initialBucket }: { invoices: OpenInvoice[]; customers: { id: string; name: string }[]; initialBucket?: ArFilters["bucket"] }) {
  const [filters, setFilters] = React.useState<ArFilters>({ ...DEFAULT, bucket: initialBucket ?? "all" });
  const [sort, setSort] = React.useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "daysOverdue", dir: "desc" });

  const rows = React.useMemo(() => {
    const filtered = applyArFilters(invoices, filters);
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      switch (sort.key) {
        case "balance":
          return (a.balance - b.balance) * dir;
        case "dueDate":
          return a.effectiveDueDate.localeCompare(b.effectiveDueDate) * dir;
        case "customer":
          return a.customerName.localeCompare(b.customerName) * dir;
        default:
          return (a.daysOverdue - b.daysOverdue) * dir;
      }
    });
  }, [invoices, filters, sort]);

  const total = rows.reduce((s, r) => s + r.balance, 0);
  const exportHref = React.useMemo(() => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(filters)) if (v !== undefined && v !== "" && v !== "all") p.set(k, String(v));
    const q = p.toString();
    return `/api/export/receivables${q ? `?${q}` : ""}`;
  }, [filters]);

  const set = <K extends keyof ArFilters>(k: K, v: ArFilters[K]) => setFilters((f) => ({ ...f, [k]: v }));
  const num = (v: string) => (v.trim() === "" || Number.isNaN(Number(v)) ? undefined : Math.max(0, Number(v)));

  function header(label: string, key: SortKey, numeric = false) {
    const active = sort.key === key;
    return (
      <TH numeric={numeric} aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
        <button type="button" className="inline-flex items-center gap-1 hover:text-text" onClick={() => setSort((s) => ({ key, dir: s.key === key && s.dir === "desc" ? "asc" : "desc" }))}>
          {label}
          {active ? <span aria-hidden>{sort.dir === "asc" ? "↑" : "↓"}</span> : null}
        </button>
      </TH>
    );
  }

  return (
    <div>
      <div className="grid grid-cols-2 gap-3 border-b border-border px-5 pb-4 md:grid-cols-3 xl:grid-cols-7" role="group" aria-label="Invoice filters">
        <div className="col-span-2 md:col-span-1 xl:col-span-2">
          <label htmlFor="f-customer" className="mb-1 block text-[12px] font-medium text-text-3">Customer</label>
          <Select id="f-customer" value={filters.customer ?? ""} onChange={(e) => set("customer", e.target.value || undefined)}>
            <option value="">All customers</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </Select>
        </div>
        <div>
          <label htmlFor="f-bucket" className="mb-1 block text-[12px] font-medium text-text-3">Aging</label>
          <Select id="f-bucket" value={filters.bucket} onChange={(e) => set("bucket", e.target.value as ArFilters["bucket"])}>
            <option value="all">All</option>
            <option value="overdue">All overdue</option>
            {AGING_BUCKETS.map((b) => (
              <option key={b.key} value={b.key}>{b.label}</option>
            ))}
          </Select>
        </div>
        <div>
          <label htmlFor="f-status" className="mb-1 block text-[12px] font-medium text-text-3">Status</label>
          <Select id="f-status" value={filters.status} onChange={(e) => set("status", e.target.value as ArFilters["status"])}>
            <option value="all">All</option>
            <option value="unpaid">Unpaid</option>
            <option value="partially-paid">Partially paid</option>
          </Select>
        </div>
        <div>
          <label htmlFor="f-min" className="mb-1 block text-[12px] font-medium text-text-3">Min balance</label>
          <Input id="f-min" inputMode="decimal" placeholder="$0" value={filters.minBalance ?? ""} onChange={(e) => set("minBalance", num(e.target.value))} />
        </div>
        <div>
          <label htmlFor="f-from" className="mb-1 block text-[12px] font-medium text-text-3">Due from</label>
          <Input id="f-from" type="date" value={filters.dueFrom ?? ""} onChange={(e) => set("dueFrom", e.target.value || undefined)} />
        </div>
        <div>
          <label htmlFor="f-to" className="mb-1 block text-[12px] font-medium text-text-3">Due to</label>
          <Input id="f-to" type="date" value={filters.dueTo ?? ""} onChange={(e) => set("dueTo", e.target.value || undefined)} />
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
        <p className="text-[13px] text-text-3" aria-live="polite">
          {rows.length} invoice{rows.length === 1 ? "" : "s"} · <span className="tabular font-medium text-text">{formatCurrency(total)}</span> outstanding
        </p>
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={() => setFilters(DEFAULT)}>
            <RotateCcw /> Reset
          </Button>
          <Button size="sm" asChild>
            <a href={exportHref} download>
              <Download /> Export CSV
            </a>
          </Button>
        </div>
      </div>
      {rows.length === 0 ? (
        <EmptyState title="No invoices match these filters" description="Adjust or reset the filters above." />
      ) : (
        <TableWrap aria-label="Unpaid invoices" className="max-h-[560px] overflow-y-auto border-t border-border">
          <Table>
            <THead className="sticky top-0 z-10 bg-surface">
              <TR className="hover:bg-transparent">
                <TH>Invoice</TH>
                {header("Customer", "customer")}
                <TH>Invoice date</TH>
                {header("Due date", "dueDate")}
                {header("Days overdue", "daysOverdue", true)}
                <TH numeric>Original</TH>
                {header("Balance", "balance", true)}
                <TH>Status</TH>
              </TR>
            </THead>
            <TBody>
              {rows.map((i) => (
                <TR key={i.id}>
                  <TD className="tabular font-medium">#{i.docNumber ?? i.id}</TD>
                  <TD className="max-w-56 truncate">{i.customerName}</TD>
                  <TD className="tabular whitespace-nowrap text-text-2">{formatIsoDate(i.txnDate)}</TD>
                  <TD className="tabular whitespace-nowrap text-text-2">
                    {i.dueDate ? formatIsoDate(i.dueDate) : <span title="No due date in source; invoice date used">{formatIsoDate(i.txnDate)}*</span>}
                  </TD>
                  <TD numeric className={i.daysOverdue > 60 ? "font-medium text-critical-text" : i.daysOverdue > 0 ? "text-text" : "text-text-3"}>
                    {i.daysOverdue > 0 ? i.daysOverdue : "—"}
                  </TD>
                  <TD numeric className="text-text-2">{formatCurrency(i.totalAmount, { cents: true })}</TD>
                  <TD numeric className="font-medium">{formatCurrency(i.balance, { cents: true })}</TD>
                  <TD>
                    <div className="flex flex-wrap gap-1">
                      {i.status === "partially-paid" ? <Badge tone="accent">Partially paid</Badge> : <Badge>Unpaid</Badge>}
                      {i.daysOverdue > 0 ? <Badge tone={i.daysOverdue > 60 ? "critical" : "warning"}>{AGING_BUCKETS.find((b) => b.key === i.bucket)!.shortLabel} days</Badge> : <Badge tone="good">Current</Badge>}
                    </div>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </TableWrap>
      )}
    </div>
  );
}
