"use client";

import { ArrowRight, Building2, FileLock2, LineChart, Lock, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { brand } from "@/config/brand";
import { BUSINESSES } from "@/data/businesses";
import { DEALS } from "@/data/deals";
import type { Role } from "@/data/types";
import { DEFAULT_ADMIN_ID, DEFAULT_INVESTOR_ID, DEFAULT_OWNER_ID, getUser } from "@/data/users";
import { money } from "@/lib/format";
import { useStore } from "@/lib/store";
import { Logo } from "@/components/shell/logo";
import { ROLE_HOME, ROLE_LABEL } from "@/components/shell/nav";
import { Badge } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";

const live = DEALS.filter((d) => d.status === "live");
const totalRevenue = live.reduce((n, d) => n + d.revenue, 0);
const liveStates = new Set(live.map((d) => BUSINESSES.find((b) => b.id === d.businessId)?.state)).size;

const PILLARS = [
  {
    icon: Building2,
    title: "For certified business owners",
    body: "List your company for a minority investment, growth capital, a majority sale or a full exit. Your name and location stay private until you know who is asking.",
  },
  {
    icon: LineChart,
    title: "For investors and acquirers",
    body: "Browse certification-verified deal flow with real financials, filter by your investment criteria and pursue the opportunities that fit.",
  },
  {
    icon: FileLock2,
    title: "NDA-gated disclosure",
    body: "One standard NDA, signed in a few clicks, unlocks the company name, the CIM and a direct line to the owner. Every signature is logged.",
  },
];

const STEPS = [
  `Owner lists anonymously; ${brand.sponsor.short} verifies certification and reviews the listing`,
  "Investors review the anonymized teaser and financial summary",
  "Investor signs the platform's standard NDA",
  "Company identity and CIM unlock; investor sends an inquiry",
  "Owner reviews the investor's profile and responds",
];

export default function LandingPage() {
  const router = useRouter();
  const { setRole, setInvestor, setOwner } = useStore();

  const enter = (role: Role) => {
    if (role === "investor") setInvestor(DEFAULT_INVESTOR_ID);
    else if (role === "owner") setOwner(DEFAULT_OWNER_ID);
    else setRole("admin");
    router.push(ROLE_HOME[role]);
  };

  const personas: { role: Role; userId: string; blurb: string }[] = [
    { role: "investor", userId: DEFAULT_INVESTOR_ID, blurb: "Browse the deal feed, sign an NDA, unlock a CIM and send an inquiry." },
    { role: "owner", userId: DEFAULT_OWNER_ID, blurb: "Edit your listing, track certification status and respond to investors." },
    { role: "admin", userId: DEFAULT_ADMIN_ID, blurb: "Review new listings, verify certifications and monitor platform activity." },
  ];

  return (
    <div className="min-h-screen bg-white">
      <header className="border-b border-slate-200">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Logo />
          <Button onClick={() => enter("investor")} size="sm">
            Enter the demo <ArrowRight />
          </Button>
        </div>
      </header>

      <section className="mx-auto grid max-w-6xl gap-10 px-4 pt-12 pb-10 sm:px-6 lg:grid-cols-[1.1fr_0.9fr] lg:pt-16">
        <div>
          <Badge tone="brand" className="mb-4">
            <ShieldCheck /> Exclusively {brand.sponsor.short}-certified MBEs
          </Badge>
          <h1 className="text-[34px] font-semibold leading-[1.12] tracking-tight text-slate-900 sm:text-[42px]">
            Investment and acquisition capital for certified minority businesses.
          </h1>
          <p className="mt-4 max-w-xl text-[16px] leading-relaxed text-slate-600">
            {brand.name} connects minority business enterprises certified by the {brand.sponsor.name} with the investors and buyers who
            want to back them. Owners list anonymously, investors review vetted teasers, and confidential materials are released only
            after a signed NDA.
          </p>
          <div className="mt-6 flex flex-wrap gap-2">
            <Button size="lg" onClick={() => enter("investor")}>
              Browse deals as an investor <ArrowRight />
            </Button>
            <Button size="lg" variant="outline" onClick={() => enter("owner")}>
              List a business
            </Button>
          </div>
          <dl className="mt-8 grid max-w-lg grid-cols-3 gap-4 border-t border-slate-200 pt-5">
            <div>
              <dt className="text-xs text-slate-500">Live opportunities</dt>
              <dd className="text-xl font-semibold tabular-nums text-slate-900">{live.length}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Combined revenue</dt>
              <dd className="text-xl font-semibold tabular-nums text-slate-900">{money(totalRevenue)}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">States represented</dt>
              <dd className="text-xl font-semibold tabular-nums text-slate-900">{liveStates}</dd>
            </div>
          </dl>
        </div>

        {/* Illustrative locked teaser */}
        <div className="relative">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 shadow-sm">
            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium text-slate-500">{brand.refPrefix}-1001 · Industrial Manufacturing · TX</span>
                <Badge tone="slate">Majority Sale</Badge>
              </div>
              <p className="mt-2 text-[15px] font-semibold leading-snug text-slate-900">
                AS9100-Certified Precision Machining Platform Serving Aerospace and Energy OEMs
              </p>
              <div className="mt-3 grid grid-cols-3 gap-3 rounded-md bg-slate-50 p-3">
                <div>
                  <div className="text-[10.5px] uppercase tracking-wide text-slate-500">Revenue</div>
                  <div className="text-sm font-semibold tabular-nums">$18.4M</div>
                </div>
                <div>
                  <div className="text-[10.5px] uppercase tracking-wide text-slate-500">EBITDA</div>
                  <div className="text-sm font-semibold tabular-nums">$3.1M</div>
                </div>
                <div>
                  <div className="text-[10.5px] uppercase tracking-wide text-slate-500">Years</div>
                  <div className="text-sm font-semibold tabular-nums">24</div>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                <Badge tone="brand">
                  <ShieldCheck /> {brand.sponsor.short} MBE
                </Badge>
                <Badge tone="slate">VOSB</Badge>
              </div>
            </div>
            <div className="mt-3 flex items-center gap-3 rounded-lg border border-dashed border-slate-300 bg-white px-4 py-3">
              <Lock className="size-4 text-slate-400" />
              <div className="flex-1 text-[13px]">
                <div className="font-medium text-slate-800">Company name, city and CIM</div>
                <div className="text-slate-500">Released after the standard NDA is signed</div>
              </div>
              <Badge tone="amber">Locked</Badge>
            </div>
          </div>
        </div>
      </section>

      <section className="border-y border-slate-200 bg-slate-50">
        <div className="mx-auto grid max-w-6xl gap-6 px-4 py-10 sm:px-6 md:grid-cols-3">
          {PILLARS.map((p) => (
            <div key={p.title}>
              <p.icon className="size-5 text-brand" />
              <h2 className="mt-3 text-[15px] font-semibold text-slate-900">{p.title}</h2>
              <p className="mt-1.5 text-[13.5px] leading-relaxed text-slate-600">{p.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <h2 className="text-[13px] font-semibold uppercase tracking-[0.08em] text-slate-500">How a deal moves</h2>
        <ol className="mt-4 grid gap-3 md:grid-cols-5">
          {STEPS.map((s, i) => (
            <li key={s} className="rounded-lg border border-slate-200 bg-white p-3.5">
              <span className="text-xs font-semibold tabular-nums text-brand">0{i + 1}</span>
              <p className="mt-1 text-[13px] leading-snug text-slate-700">{s}</p>
            </li>
          ))}
        </ol>

        <h2 className="mt-10 text-[13px] font-semibold uppercase tracking-[0.08em] text-slate-500">Enter the demo as</h2>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          {personas.map((p) => {
            const u = getUser(p.userId)!;
            return (
              <button
                key={p.role}
                type="button"
                onClick={() => enter(p.role)}
                className="group rounded-lg border border-slate-200 bg-white p-4 text-left transition hover:border-brand hover:shadow-sm"
              >
                <div className="flex items-center justify-between">
                  <span className="text-[15px] font-semibold text-slate-900">{ROLE_LABEL[p.role]}</span>
                  <ArrowRight className="size-4 text-slate-400 transition group-hover:translate-x-0.5 group-hover:text-brand" />
                </div>
                <p className="mt-0.5 text-[12.5px] text-slate-500">
                  {u.name} · {u.firmName}
                </p>
                <p className="mt-2 text-[13px] leading-relaxed text-slate-600">{p.blurb}</p>
              </button>
            );
          })}
        </div>
      </section>

      <footer className="border-t border-slate-200">
        <div className="mx-auto max-w-6xl px-4 py-6 text-xs leading-relaxed text-slate-500 sm:px-6">
          Prototype for demonstration. All companies, investors and figures are fictional sample data. Nothing on this site is an
          offer to buy or sell securities.
        </div>
      </footer>
    </div>
  );
}
