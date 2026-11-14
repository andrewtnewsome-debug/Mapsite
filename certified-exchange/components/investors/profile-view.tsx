"use client";

import { Building2, Globe, Mail, MapPin, Pencil, X } from "lucide-react";
import { useState } from "react";
import { brand } from "@/config/brand";
import { DEAL_TYPE_LABEL } from "@/data/taxonomy";
import { DEAL_TYPES, INDUSTRIES, REGIONS, type DealType, type Industry, type InvestorProfile, type Region } from "@/data/types";
import { getUser } from "@/data/users";
import { money } from "@/lib/format";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { VerifiedInvestorBadge } from "@/components/deals/badges";
import { Button } from "@/components/ui/button";
import { Badge, Card, CardBody, CardHeader, Field, Input, Switch, Textarea } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";

export function InvestorProfileView({
  profile,
  mode,
  ndaCount,
}: {
  profile: InvestorProfile;
  mode: "self" | "owner" | "admin";
  ndaCount?: number;
}) {
  const { setInvestorVerified } = useStore();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const user = getUser(profile.userId);

  return (
    <div className="space-y-5">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-4 px-5 py-5">
          <div className="flex min-w-0 items-start gap-4">
            <span className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-slate-900 text-white">
              <Building2 className="size-5" />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl font-semibold tracking-tight text-slate-900">{profile.firmName}</h1>
                <VerifiedInvestorBadge verified={profile.verified} />
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-slate-500">
                <Badge tone="slate">{profile.firmType}</Badge>
                <span className="inline-flex items-center gap-1">
                  <MapPin className="size-3.5" /> {profile.headquarters}
                </span>
                <span className="inline-flex items-center gap-1">
                  <Globe className="size-3.5" /> {profile.website}
                </span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {mode === "self" && !editing && (
              <Button variant="outline" onClick={() => setEditing(true)}>
                <Pencil /> Edit criteria
              </Button>
            )}
            {mode === "admin" && (
              <label className="flex items-center gap-2.5 rounded-md border border-slate-200 px-3 py-2 text-[13px] font-medium text-slate-800">
                Verified investor
                <Switch
                  checked={profile.verified}
                  label="Verified investor"
                  onChange={(v) => {
                    setInvestorVerified(profile.id, v);
                    toast({ title: v ? `${profile.firmName} marked verified` : `Verification removed for ${profile.firmName}` });
                  }}
                />
              </label>
            )}
          </div>
        </div>
        <p className="border-t border-slate-100 px-5 py-4 text-[14px] leading-relaxed text-slate-700">{profile.overview}</p>
      </Card>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        {editing ? (
          <CriteriaEditor profile={profile} onDone={() => setEditing(false)} />
        ) : (
          <Card>
            <CardHeader title="Investment criteria" description="Used to match deals in the feed and shared with owners after an NDA" />
            <CardBody className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-3">
                <Fact label="Equity check size" value={`${money(profile.checkSizeMin)} – ${money(profile.checkSizeMax)}`} />
                <Fact label="Target EBITDA" value={`${money(profile.ebitdaMin)} – ${money(profile.ebitdaMax)}`} />
                <Fact label="Source of capital" value={profile.capitalSource} />
              </div>
              <ChipRow label="Industries" items={profile.industries} />
              <ChipRow label="Geographies" items={profile.geographies.length === REGIONS.length ? ["National"] : profile.geographies} />
              <ChipRow label="Deal types" items={profile.dealTypes.map((d) => DEAL_TYPE_LABEL[d])} />
            </CardBody>
          </Card>
        )}

        <div className="space-y-5">
          <Card>
            <CardHeader title="Contact" />
            <CardBody className="space-y-1 text-[13px]">
              <div className="font-medium text-slate-900">{user?.name}</div>
              <div className="text-slate-600">{user?.title}</div>
              <div className="inline-flex items-center gap-1.5 text-slate-600">
                <Mail className="size-3.5" /> {user?.email}
              </div>
              {mode === "owner" && (
                <p className="pt-2 text-[12px] text-slate-500">Contact details are shared because this investor signed the NDA on your listing.</p>
              )}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Verification" />
            <CardBody className="space-y-2 text-[13px] text-slate-600">
              <VerifiedInvestorBadge verified={profile.verified} />
              <p className="leading-relaxed">
                {profile.verified
                  ? `${brand.sponsor.short} staff confirmed this firm's identity, investment authority and source of capital.`
                  : `${brand.sponsor.short} staff have not yet confirmed this firm's identity and source of capital.`}
              </p>
              {mode === "self" && <p className="text-[12px] text-slate-500">Verification is managed by {brand.sponsor.short} staff.</p>}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Track record" />
            <CardBody>
              <ul className="space-y-1.5 text-[13px] text-slate-700">
                {profile.recentActivity.map((a) => (
                  <li key={a}>· {a}</li>
                ))}
              </ul>
              {ndaCount !== undefined && (
                <p className="mt-3 border-t border-slate-100 pt-2 text-[12px] text-slate-500">
                  {ndaCount} NDA{ndaCount === 1 ? "" : "s"} signed on {brand.name}
                </p>
              )}
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-0.5 text-[14px] font-semibold text-slate-900">{value}</div>
    </div>
  );
}

function ChipRow({ label, items }: { label: string; items: string[] }) {
  return (
    <div>
      <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className="flex flex-wrap gap-1.5">
        {items.map((i) => (
          <Badge key={i} tone="slate" className="text-[12px]">
            {i}
          </Badge>
        ))}
      </div>
    </div>
  );
}

function ToggleChips<T extends string>({
  label,
  options,
  selected,
  onChange,
  render,
}: {
  label: string;
  options: readonly T[];
  selected: T[];
  onChange: (v: T[]) => void;
  render?: (v: T) => string;
}) {
  return (
    <div>
      <div className="mb-1.5 text-[13px] font-medium text-slate-700">{label}</div>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => {
          const on = selected.includes(o);
          return (
            <button
              key={o}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(on ? selected.filter((x) => x !== o) : [...selected, o])}
              className={cn(
                "rounded-full border px-2.5 py-1 text-[12.5px] font-medium transition-colors",
                on ? "border-brand bg-brand/10 text-brand" : "border-slate-200 text-slate-600 hover:bg-slate-50",
              )}
            >
              {render ? render(o) : o}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function CriteriaEditor({ profile, onDone }: { profile: InvestorProfile; onDone: () => void }) {
  const { updateInvestorProfile } = useStore();
  const toast = useToast();
  const m = (n: number) => String(n / 1_000_000);
  const [checkMin, setCheckMin] = useState(m(profile.checkSizeMin));
  const [checkMax, setCheckMax] = useState(m(profile.checkSizeMax));
  const [ebitdaMin, setEbitdaMin] = useState(m(profile.ebitdaMin));
  const [ebitdaMax, setEbitdaMax] = useState(m(profile.ebitdaMax));
  const [industries, setIndustries] = useState<Industry[]>(profile.industries);
  const [geos, setGeos] = useState<Region[]>(profile.geographies);
  const [dealTypes, setDealTypes] = useState<DealType[]>(profile.dealTypes);
  const [overview, setOverview] = useState(profile.overview);

  const num = (s: string) => Math.round(parseFloat(s || "0") * 1_000_000);
  const valid = num(checkMax) >= num(checkMin) && num(ebitdaMax) >= num(ebitdaMin) && industries.length && geos.length && dealTypes.length;

  return (
    <Card>
      <CardHeader
        title="Edit investment criteria"
        actions={
          <Button variant="ghost" size="icon" onClick={onDone} aria-label="Cancel editing">
            <X />
          </Button>
        }
      />
      <CardBody className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-4">
          <Field label="Check size min ($M)" htmlFor="c-min">
            <Input id="c-min" inputMode="decimal" value={checkMin} onChange={(e) => setCheckMin(e.target.value)} />
          </Field>
          <Field label="Check size max ($M)" htmlFor="c-max">
            <Input id="c-max" inputMode="decimal" value={checkMax} onChange={(e) => setCheckMax(e.target.value)} />
          </Field>
          <Field label="EBITDA min ($M)" htmlFor="e-min">
            <Input id="e-min" inputMode="decimal" value={ebitdaMin} onChange={(e) => setEbitdaMin(e.target.value)} />
          </Field>
          <Field label="EBITDA max ($M)" htmlFor="e-max">
            <Input id="e-max" inputMode="decimal" value={ebitdaMax} onChange={(e) => setEbitdaMax(e.target.value)} />
          </Field>
        </div>
        <ToggleChips label="Industries" options={INDUSTRIES} selected={industries} onChange={setIndustries} />
        <ToggleChips label="Geographies" options={REGIONS} selected={geos} onChange={setGeos} />
        <ToggleChips label="Deal types" options={DEAL_TYPES} selected={dealTypes} onChange={setDealTypes} render={(d) => DEAL_TYPE_LABEL[d]} />
        <Field label="Firm overview" htmlFor="ov">
          <Textarea id="ov" rows={4} value={overview} onChange={(e) => setOverview(e.target.value)} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onDone}>
            Cancel
          </Button>
          <Button
            disabled={!valid}
            onClick={() => {
              updateInvestorProfile(profile.id, {
                checkSizeMin: num(checkMin),
                checkSizeMax: num(checkMax),
                ebitdaMin: num(ebitdaMin),
                ebitdaMax: num(ebitdaMax),
                industries,
                geographies: geos,
                dealTypes,
                overview: overview.trim(),
              });
              toast({ title: "Criteria updated", body: "Deal matching in the feed now uses your new criteria." });
              onDone();
            }}
          >
            Save criteria
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
