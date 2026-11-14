"use client";

import { AlertCircle, AlertTriangle, CheckCircle2, Lock, Pause, Play, Plus, Save, Send, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { brand } from "@/config/brand";
import { STATE_NAMES, STATE_REGION } from "@/data/businesses";
import { DEAL_TYPE_LABEL } from "@/data/taxonomy";
import { DEAL_TYPES, EMPLOYEE_RANGES, INDUSTRIES, type DealType, type EmployeeRange, type Industry } from "@/data/types";
import { dealRef, margin, money, pct, shortDate } from "@/lib/format";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { DealStatusPill, DealTypePill } from "@/components/deals/badges";
import { CertificationPanel } from "@/components/owner/cert-panel";
import { useOwnerListing } from "@/components/owner/use-owner";
import { RoleGate } from "@/components/shell/role-gate";
import { Button } from "@/components/ui/button";
import { Badge, Card, CardBody, CardHeader, EmptyState, Field, Input, PageHeader, Select, Textarea } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";

interface FormState {
  teaserTitle: string;
  teaserDescription: string;
  highlights: string[];
  companyName: string;
  city: string;
  industry: Industry;
  state: string;
  yearsInBusiness: string;
  employeeRange: EmployeeRange;
  revenue: string;
  ebitda: string;
  askingValuation: string;
  dealType: DealType;
  seeking: string;
  useOfProceeds: string;
  ownerRole: string;
}

const toNum = (s: string) => Number(String(s).replace(/[^0-9.]/g, "")) || 0;
const fmtInput = (n: number | undefined) => (n ? n.toLocaleString("en-US") : "");

export default function ListingBuilderPage() {
  return (
    <RoleGate allow={["owner"]}>
      <ListingBuilder />
    </RoleGate>
  );
}

function ListingBuilder() {
  const store = useStore();
  const toast = useToast();
  const { business, deal } = useOwnerListing();
  const [form, setForm] = useState<FormState | null>(null);
  const [dirty, setDirty] = useState(false);
  const [showErrors, setShowErrors] = useState(false);

  // Initialise (and re-initialise when switching owner personas).
  useEffect(() => {
    if (!deal || !business) return;
    setForm({
      teaserTitle: deal.teaserTitle,
      teaserDescription: deal.teaserDescription,
      highlights: [...deal.highlights],
      companyName: deal.companyName,
      city: deal.city,
      industry: business.industry,
      state: business.state,
      yearsInBusiness: String(business.yearsInBusiness),
      employeeRange: business.employeeRange,
      revenue: fmtInput(deal.revenue),
      ebitda: fmtInput(deal.ebitda),
      askingValuation: fmtInput(deal.askingValuation),
      dealType: deal.dealType,
      seeking: deal.seeking,
      useOfProceeds: deal.cim.transaction.useOfProceeds,
      ownerRole: deal.cim.transaction.ownerRole,
    });
    setDirty(false);
    setShowErrors(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deal?.id]);

  const issues = useMemo(() => {
    if (!form) return [];
    const list: { field: keyof FormState | "anonymity"; msg: string }[] = [];
    if (form.teaserTitle.trim().length < 15) list.push({ field: "teaserTitle", msg: "Teaser headline should be at least 15 characters." });
    if (form.teaserDescription.trim().length < 120) list.push({ field: "teaserDescription", msg: "Business description should be at least 120 characters." });
    if (form.highlights.filter((h) => h.trim()).length < 3) list.push({ field: "highlights", msg: "Add at least three investment highlights." });
    if (!form.companyName.trim()) list.push({ field: "companyName", msg: "Company name is required (released only after NDA)." });
    if (!form.city.trim()) list.push({ field: "city", msg: "City is required (released only after NDA)." });
    if (toNum(form.revenue) <= 0) list.push({ field: "revenue", msg: "Enter FY2025 revenue." });
    if (toNum(form.ebitda) <= 0) list.push({ field: "ebitda", msg: "Enter FY2025 adjusted EBITDA." });
    if (toNum(form.ebitda) > toNum(form.revenue)) list.push({ field: "ebitda", msg: "EBITDA cannot exceed revenue." });
    if (form.seeking.trim().length < 30) list.push({ field: "seeking", msg: "Describe what you are looking for in at least 30 characters." });
    // Anonymity check: the public teaser must not reveal identity or city.
    const publicText = [form.teaserTitle, form.teaserDescription, ...form.highlights, form.seeking].join(" ").toLowerCase();
    const mentions = (phrase: string) =>
      !!phrase && new RegExp(`(?<![\\w-])${phrase.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w-])`).test(publicText);
    // The distinctive part of the name: first word, or first two words when the first is short or generic.
    const words = form.companyName.replace(/[,.&]/g, " ").split(/\s+/).filter(Boolean);
    const generic = ["first", "new", "american", "national", "united", "general", "premier", "global", "pacific", "queen", "the"];
    const distinctive = words[0] && (words[0].length <= 5 || generic.includes(words[0].toLowerCase())) ? words.slice(0, 2).join(" ") : words[0] ?? "";
    const leaked = [distinctive, form.companyName, form.city].filter((p) => p && mentions(p.trim()));
    if (leaked.length) list.push({ field: "anonymity", msg: `Public teaser may identify the business: “${Array.from(new Set(leaked)).join("”, “")}”. Remove names and city from public fields.` });
    return list;
  }, [form]);

  if (!business || !deal) {
    return (
      <Card>
        <EmptyState title="No business on file" />
      </Card>
    );
  }
  if (!form) return null;

  const update = <K extends keyof FormState>(k: K, v: FormState[K]) => {
    setForm((f) => (f ? { ...f, [k]: v } : f));
    setDirty(true);
  };
  const err = (k: keyof FormState) => (showErrors ? issues.find((i) => i.field === k)?.msg : undefined);

  const persist = () => {
    store.updateDeal(deal.id, {
      teaserTitle: form.teaserTitle.trim(),
      teaserDescription: form.teaserDescription.trim(),
      highlights: form.highlights.map((h) => h.trim()).filter(Boolean),
      companyName: form.companyName.trim(),
      city: form.city.trim(),
      revenue: toNum(form.revenue),
      ebitda: toNum(form.ebitda),
      askingValuation: toNum(form.askingValuation) || undefined,
      dealType: form.dealType,
      seeking: form.seeking.trim(),
      cim: { ...deal.cim, transaction: { ...deal.cim.transaction, useOfProceeds: form.useOfProceeds.trim(), ownerRole: form.ownerRole.trim() } },
    });
    store.updateBusiness(business.id, {
      industry: form.industry,
      state: form.state,
      region: STATE_REGION[form.state] ?? business.region,
      city: form.city.trim(),
      legalName: business.legalName,
      yearsInBusiness: toNum(form.yearsInBusiness),
      employeeRange: form.employeeRange,
    });
    setDirty(false);
  };

  const canSubmit = deal.status === "draft" || deal.status === "changes_requested";
  const isLive = deal.status === "live";

  const onSave = () => {
    persist();
    toast({ title: isLive ? "Listing updated" : "Draft saved", body: isLive ? "Changes are visible to investors now." : undefined });
    // TODO(review): in production, material edits to a live listing (financials, deal type) would re-enter staff review.
  };

  const onSubmit = () => {
    setShowErrors(true);
    if (issues.length) {
      toast({ tone: "info", title: "Fix the highlighted items before submitting", body: issues[0].msg });
      return;
    }
    persist();
    store.submitForReview(deal.id);
    toast({ title: "Submitted for review", body: `${brand.sponsor.short} staff typically review new listings within two business days.` });
  };

  const rev = toNum(form.revenue);
  const ebitda = toNum(form.ebitda);
  const anonymity = issues.find((i) => i.field === "anonymity");

  return (
    <>
      <PageHeader
        eyebrow={`${dealRef(deal.id)} · ${business.legalName}`}
        title="Listing builder"
        description="Public fields form the anonymized teaser every investor sees. Confidential fields are released only to investors who sign the NDA."
        actions={
          <>
            <DealStatusPill status={deal.status} />
            {isLive && (
              <Button
                variant="outline"
                onClick={() => {
                  store.setDealPaused(deal.id, true);
                  toast({ tone: "info", title: "Listing paused", body: "It is hidden from the feed. Investors with an NDA keep access." });
                }}
              >
                <Pause /> Pause listing
              </Button>
            )}
            {deal.status === "paused" && (
              <Button
                variant="outline"
                onClick={() => {
                  store.setDealPaused(deal.id, false);
                  toast({ title: "Listing resumed", body: "Your teaser is back in the deal feed." });
                }}
              >
                <Play /> Resume listing
              </Button>
            )}
            <Button variant={canSubmit ? "outline" : "default"} onClick={onSave} disabled={!dirty}>
              <Save /> {isLive ? "Save changes" : "Save draft"}
            </Button>
            {canSubmit && (
              <Button onClick={onSubmit}>
                <Send /> Submit for review
              </Button>
            )}
          </>
        }
      />

      {deal.status === "changes_requested" && deal.reviewNote && (
        <Notice tone="red" icon={<AlertCircle />} title={`${brand.sponsor.short} staff requested changes`}>
          {deal.reviewNote}
        </Notice>
      )}
      {deal.status === "pending_review" && (
        <Notice tone="amber" icon={<AlertTriangle />} title="In review">
          Submitted {shortDate(deal.submittedAt)}. You can keep editing; staff review the latest saved version.
        </Notice>
      )}

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-5">
          <Card>
            <CardHeader title="Business description" description="Public · shown in the anonymized teaser" actions={<Badge tone="slate">Public</Badge>} />
            <CardBody className="space-y-4">
              <Field label="Teaser headline" htmlFor="f-title" required hint={err("teaserTitle") ?? "Describe the business without naming it, e.g. “Regional HVAC service contractor with recurring agreements”."}>
                <Input id="f-title" value={form.teaserTitle} onChange={(e) => update("teaserTitle", e.target.value)} className={cn(err("teaserTitle") && "border-red-400")} />
              </Field>
              <Field
                label="Business description"
                htmlFor="f-desc"
                required
                hint={err("teaserDescription") ?? `${form.teaserDescription.trim().length} characters. Cover what you do, who you serve and why you are listing. Use region, not city.`}
              >
                <Textarea id="f-desc" rows={5} value={form.teaserDescription} onChange={(e) => update("teaserDescription", e.target.value)} className={cn(err("teaserDescription") && "border-red-400")} />
              </Field>
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-[13px] font-medium text-slate-700">
                    Investment highlights <span className="text-red-600">*</span>
                  </span>
                  <Button size="sm" variant="ghost" onClick={() => update("highlights", [...form.highlights, ""])} disabled={form.highlights.length >= 7}>
                    <Plus /> Add highlight
                  </Button>
                </div>
                <div className="space-y-2">
                  {form.highlights.map((h, i) => (
                    <div key={i} className="flex gap-2">
                      <Input
                        value={h}
                        aria-label={`Highlight ${i + 1}`}
                        onChange={(e) => update("highlights", form.highlights.map((x, j) => (j === i ? e.target.value : x)))}
                        placeholder="e.g. 78% of revenue under multi-year contracts"
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Remove highlight ${i + 1}`}
                        onClick={() => update("highlights", form.highlights.filter((_, j) => j !== i))}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  ))}
                </div>
                {err("highlights") && <p className="mt-1 text-xs text-red-600">{err("highlights")}</p>}
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Confidential details"
              description="Released only to investors who sign the NDA"
              actions={
                <Badge tone="amber">
                  <Lock /> NDA only
                </Badge>
              }
            />
            <CardBody className="grid gap-4 sm:grid-cols-2">
              <Field label="Company name (as shown to NDA signers)" htmlFor="f-name" required hint={err("companyName")}>
                <Input id="f-name" value={form.companyName} onChange={(e) => update("companyName", e.target.value)} />
              </Field>
              <Field label="City" htmlFor="f-city" required hint={err("city")}>
                <Input id="f-city" value={form.city} onChange={(e) => update("city", e.target.value)} />
              </Field>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Industry & location" />
            <CardBody className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Industry" htmlFor="f-industry">
                <Select id="f-industry" value={form.industry} onChange={(e) => update("industry", e.target.value as Industry)}>
                  {INDUSTRIES.map((i) => (
                    <option key={i}>{i}</option>
                  ))}
                </Select>
              </Field>
              <Field label="State" htmlFor="f-state" hint={`Region: ${STATE_REGION[form.state] ?? "—"}`}>
                <Select id="f-state" value={form.state} onChange={(e) => update("state", e.target.value)}>
                  {Object.keys(STATE_REGION)
                    .sort()
                    .map((s) => (
                      <option key={s} value={s}>
                        {STATE_NAMES[s]}
                      </option>
                    ))}
                </Select>
              </Field>
              <Field label="Years in business" htmlFor="f-years">
                <Input id="f-years" inputMode="numeric" value={form.yearsInBusiness} onChange={(e) => update("yearsInBusiness", e.target.value.replace(/\D/g, ""))} />
              </Field>
              <Field label="Employees" htmlFor="f-emp">
                <Select id="f-emp" value={form.employeeRange} onChange={(e) => update("employeeRange", e.target.value as EmployeeRange)}>
                  {EMPLOYEE_RANGES.map((r) => (
                    <option key={r}>{r}</option>
                  ))}
                </Select>
              </Field>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Financials" description="FY2025 figures appear in the public teaser. Detailed three-year financials are in the CIM." />
            <CardBody className="grid gap-4 sm:grid-cols-3">
              <MoneyField id="f-rev" label="Revenue (FY2025)" value={form.revenue} onChange={(v) => update("revenue", v)} error={err("revenue")} required />
              <MoneyField id="f-ebitda" label="Adjusted EBITDA (FY2025)" value={form.ebitda} onChange={(v) => update("ebitda", v)} error={err("ebitda")} required hint={rev ? `${pct(margin(ebitda, rev))} margin` : undefined} />
              <MoneyField
                id="f-val"
                label="Asking valuation (optional)"
                value={form.askingValuation}
                onChange={(v) => update("askingValuation", v)}
                hint={toNum(form.askingValuation) && ebitda ? `${(toNum(form.askingValuation) / ebitda).toFixed(1)}x adj. EBITDA` : "Leave blank to invite proposals"}
              />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Deal structure & what you're looking for" />
            <CardBody className="space-y-4">
              <div>
                <span className="mb-1.5 block text-[13px] font-medium text-slate-700">Deal type</span>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4" role="radiogroup" aria-label="Deal type">
                  {DEAL_TYPES.map((t) => (
                    <button
                      key={t}
                      type="button"
                      role="radio"
                      aria-checked={form.dealType === t}
                      onClick={() => update("dealType", t)}
                      className={cn(
                        "rounded-md border px-3 py-2.5 text-left text-[13px] transition-colors",
                        form.dealType === t ? "border-brand bg-brand/5 ring-1 ring-brand" : "border-slate-200 hover:bg-slate-50",
                      )}
                    >
                      <div className="font-medium text-slate-900">{DEAL_TYPE_LABEL[t]}</div>
                      <div className="mt-0.5 text-[11.5px] text-slate-500">
                        {
                          {
                            minority: "Sell less than 50%; keep control",
                            majority: "Sell control; retain a stake",
                            full_exit: "Sell 100% with a transition",
                            growth: "Raise capital for expansion",
                          }[t]
                        }
                      </div>
                    </button>
                  ))}
                </div>
                {(form.dealType === "majority" || form.dealType === "full_exit") && (
                  <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-[12px] text-amber-900">
                    Transferring majority ownership to a non-minority buyer may end the company&apos;s MBE certification. Note any structure you require in the field below.
                  </p>
                )}
              </div>
              <Field label="What you are looking for in a partner" htmlFor="f-seeking" required hint={err("seeking") ?? "Public. Investors see this in the teaser."}>
                <Textarea id="f-seeking" rows={3} value={form.seeking} onChange={(e) => update("seeking", e.target.value)} />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Use of proceeds" htmlFor="f-proceeds" hint="Confidential · included in the CIM">
                  <Textarea id="f-proceeds" rows={3} value={form.useOfProceeds} onChange={(e) => update("useOfProceeds", e.target.value)} />
                </Field>
                <Field label="Your role after the transaction" htmlFor="f-role" hint="Confidential · included in the CIM">
                  <Textarea id="f-role" rows={3} value={form.ownerRole} onChange={(e) => update("ownerRole", e.target.value)} />
                </Field>
              </div>
            </CardBody>
          </Card>
        </div>

        <div className="space-y-5 xl:sticky xl:top-20">
          <Card>
            <CardHeader title="Teaser preview" description="What investors see before signing the NDA" />
            <CardBody>
              <div className="text-[11.5px] font-medium text-slate-500">
                {dealRef(deal.id)} · {form.industry} · {STATE_REGION[form.state]} · {form.state}
              </div>
              <div className="mt-1 text-[15px] font-semibold leading-snug text-slate-900">{form.teaserTitle || "Your teaser headline"}</div>
              <p className="mt-1.5 line-clamp-4 text-[12.5px] leading-relaxed text-slate-600">{form.teaserDescription}</p>
              <div className="mt-3 grid grid-cols-3 gap-2 rounded-md bg-slate-50 p-2.5">
                {[
                  ["Revenue", money(rev)],
                  ["EBITDA", money(ebitda)],
                  ["Years", form.yearsInBusiness || "—"],
                ].map(([k, v]) => (
                  <div key={k}>
                    <div className="text-[10px] uppercase tracking-wide text-slate-500">{k}</div>
                    <div className="text-[13px] font-semibold tabular-nums">{v}</div>
                  </div>
                ))}
              </div>
              <div className="mt-2.5">
                <DealTypePill type={form.dealType} />
              </div>
              <div
                className={cn(
                  "mt-3 flex items-start gap-2 rounded-md px-3 py-2 text-[12px]",
                  anonymity ? "bg-amber-50 text-amber-900" : "bg-emerald-50 text-emerald-800",
                )}
              >
                {anonymity ? <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> : <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" />}
                {anonymity ? anonymity.msg : "Anonymity check passed: the public teaser does not include your company name or city."}
              </div>
            </CardBody>
          </Card>
          {showErrors && issues.length > 0 && (
            <Card className="border-red-200">
              <CardBody>
                <div className="text-[13px] font-medium text-red-800">Before you submit</div>
                <ul className="mt-1.5 list-disc space-y-1 pl-4 text-[12.5px] text-red-700">
                  {issues.map((i) => (
                    <li key={i.msg}>{i.msg}</li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          )}
          <CertificationPanel business={business} />
        </div>
      </div>
    </>
  );
}

function MoneyField({
  id,
  label,
  value,
  onChange,
  hint,
  error,
  required,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
  error?: string;
  required?: boolean;
}) {
  return (
    <Field label={label} htmlFor={id} hint={error ?? hint} required={required}>
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">$</span>
        <Input
          id={id}
          inputMode="numeric"
          value={value}
          onChange={(e) => {
            const digits = e.target.value.replace(/[^0-9]/g, "");
            onChange(digits ? Number(digits).toLocaleString("en-US") : "");
          }}
          className={cn("pl-6 tabular-nums", error && "border-red-400")}
        />
      </div>
    </Field>
  );
}

function Notice({ tone, icon, title, children }: { tone: "red" | "amber"; icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        "mb-5 flex gap-3 rounded-lg border px-4 py-3 text-[13px] [&_svg]:mt-0.5 [&_svg]:size-4 [&_svg]:shrink-0",
        tone === "red" ? "border-red-200 bg-red-50 text-red-900" : "border-amber-200 bg-amber-50 text-amber-900",
      )}
    >
      {icon}
      <div>
        <div className="font-medium">{title}</div>
        <p className="mt-0.5">{children}</p>
      </div>
    </div>
  );
}
