"use client";

import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { STATE_NAMES } from "@/data/businesses";
import { CERT_FILTERS, DEAL_TYPE_LABEL, EBITDA_BANDS, REVENUE_BANDS, YEARS_OPTIONS } from "@/data/taxonomy";
import { DEAL_TYPES, INDUSTRIES, REGIONS, type DealFilters } from "@/data/types";
import type { DealRow } from "@/lib/deals";
import { cn } from "@/lib/utils";
import { Checkbox, Switch } from "@/components/ui/primitives";

function Section({ title, children, defaultOpen = true }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-slate-200 px-3 py-2.5 last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between py-0.5 text-[11.5px] font-semibold uppercase tracking-wide text-slate-600"
        aria-expanded={open}
      >
        {title}
        <ChevronDown className={cn("size-3.5 text-slate-400 transition-transform", !open && "-rotate-90")} />
      </button>
      {open && <div className="mt-1.5">{children}</div>}
    </div>
  );
}

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

export function FilterPanel({
  filters,
  onChange,
  rows,
  hasProfile,
}: {
  filters: DealFilters;
  onChange: (f: DealFilters) => void;
  rows: DealRow[];
  hasProfile: boolean;
}) {
  const set = <K extends keyof DealFilters>(key: K, value: DealFilters[K]) => onChange({ ...filters, [key]: value });
  const count = (pred: (r: DealRow) => boolean) => rows.filter(pred).length;
  const states = Array.from(new Set(rows.map((r) => r.business.state))).sort();

  return (
    <div className="rounded-lg border border-slate-200 bg-white shadow-xs">
      {hasProfile && (
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-3 py-3">
          <div>
            <div className="text-[13px] font-medium text-slate-900">Match my criteria</div>
            <div className="text-[11.5px] text-slate-500">EBITDA, industry, geography, deal type</div>
          </div>
          <Switch checked={filters.matchCriteria} onChange={(v) => set("matchCriteria", v)} label="Match my criteria" />
        </div>
      )}
      <Section title="Industry">
        {INDUSTRIES.map((i) => (
          <Checkbox
            key={i}
            label={i}
            checked={filters.industries.includes(i)}
            onChange={() => set("industries", toggle(filters.industries, i))}
            count={count((r) => r.business.industry === i)}
          />
        ))}
      </Section>
      <Section title="Region & state">
        {REGIONS.map((r) => (
          <Checkbox
            key={r}
            label={r}
            checked={filters.regions.includes(r)}
            onChange={() => set("regions", toggle(filters.regions, r))}
            count={count((x) => x.business.region === r)}
          />
        ))}
        <select
          aria-label="State"
          value={filters.states[0] ?? ""}
          onChange={(e) => set("states", e.target.value ? [e.target.value] : [])}
          className="mt-1.5 h-8 w-full rounded-md border border-slate-300 bg-white px-2 text-[13px] text-slate-700 focus:border-brand focus:outline-none"
        >
          <option value="">All states</option>
          {states.map((s) => (
            <option key={s} value={s}>
              {STATE_NAMES[s] ?? s}
            </option>
          ))}
        </select>
      </Section>
      <Section title="Revenue (FY2025)">
        {REVENUE_BANDS.map((b) => (
          <Checkbox
            key={b.id}
            label={b.label}
            checked={filters.revenueBands.includes(b.id)}
            onChange={() => set("revenueBands", toggle(filters.revenueBands, b.id))}
            count={count((r) => r.deal.revenue >= b.min && r.deal.revenue < b.max)}
          />
        ))}
      </Section>
      <Section title="Adjusted EBITDA">
        {EBITDA_BANDS.map((b) => (
          <Checkbox
            key={b.id}
            label={b.label}
            checked={filters.ebitdaBands.includes(b.id)}
            onChange={() => set("ebitdaBands", toggle(filters.ebitdaBands, b.id))}
            count={count((r) => r.deal.ebitda >= b.min && r.deal.ebitda < b.max)}
          />
        ))}
      </Section>
      <Section title="Deal type">
        {DEAL_TYPES.map((t) => (
          <Checkbox
            key={t}
            label={DEAL_TYPE_LABEL[t]}
            checked={filters.dealTypes.includes(t)}
            onChange={() => set("dealTypes", toggle(filters.dealTypes, t))}
            count={count((r) => r.deal.dealType === t)}
          />
        ))}
      </Section>
      <Section title="Certification">
        {CERT_FILTERS.map((c) => (
          <Checkbox
            key={c.id}
            label={c.label}
            checked={filters.certifications.includes(c.id)}
            onChange={() => set("certifications", toggle(filters.certifications, c.id))}
            count={count((r) => c.id === "MBE" || (r.business.additionalCertifications as string[]).includes(c.id))}
          />
        ))}
      </Section>
      <Section title="Years in business">
        <div className="grid grid-cols-2 gap-1">
          {YEARS_OPTIONS.map((y) => (
            <button
              key={y.value}
              type="button"
              onClick={() => set("minYears", y.value)}
              className={cn(
                "rounded-md border px-2 py-1 text-[12.5px] font-medium",
                filters.minYears === y.value
                  ? "border-brand bg-brand/10 text-brand"
                  : "border-slate-200 text-slate-600 hover:bg-slate-50",
              )}
            >
              {y.label}
            </button>
          ))}
        </div>
      </Section>
    </div>
  );
}
