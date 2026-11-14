"use client";

import { Menu, RotateCcw, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { brand } from "@/config/brand";
import { useStore } from "@/lib/store";
import { certHealth } from "@/lib/deals";
import { unreadTotal } from "@/lib/selectors";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/primitives";
import { Logo } from "./logo";
import { NAV, ROLE_LABEL, type NavItem } from "./nav";
import { RoleSwitcher } from "./role-switcher";
import { DemoGuideButton } from "./demo-guide";

function useBadges() {
  const { data, currentUser, session } = useStore();
  const unread = unreadTotal(data, currentUser, session.role);
  const pendingReview = data.deals.filter((d) => d.status === "pending_review").length;
  const certQueue = data.businesses.filter((b) => {
    const h = certHealth(b).status;
    return h === "pending" || h === "expired" || h === "expiring";
  }).length;
  const ownerBiz = data.businesses.find((b) => b.ownerUserId === session.ownerId);
  const ownerDeal = ownerBiz && data.deals.find((d) => d.businessId === ownerBiz.id);
  const pursuits = ownerDeal ? data.ndas.filter((n) => n.dealId === ownerDeal.id).length : 0;
  return { unread, pendingReview, certQueue, pursuits } as Record<NonNullable<NavItem["badgeKey"]>, number>;
}

function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { session, resetDemo } = useStore();
  const badges = useBadges();
  const items = NAV[session.role];

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 items-center border-b border-white/10 px-4">
        <Link href="/" onClick={onNavigate} aria-label={`${brand.name} home`}>
          <Logo dark />
        </Link>
      </div>
      <div className="px-3 pt-4 pb-2 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-slate-500">
        {ROLE_LABEL[session.role]} workspace
      </div>
      <nav className="flex-1 space-y-0.5 px-2">
        {items.map((item) => {
          const active = item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
          const count = item.badgeKey ? badges[item.badgeKey] : 0;
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              className={cn(
                "group relative flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13.5px] font-medium transition-colors",
                active ? "bg-white/10 text-white" : "text-slate-300 hover:bg-white/5 hover:text-white",
              )}
            >
              {active && <span className="absolute inset-y-1.5 left-0 w-[3px] rounded-r bg-brand" />}
              <Icon className={cn("size-4", active ? "text-white" : "text-slate-400 group-hover:text-slate-200")} />
              <span className="flex-1">{item.label}</span>
              {count > 0 && (
                <span className="min-w-5 rounded-full bg-brand px-1.5 py-0.5 text-center text-[10.5px] font-semibold tabular-nums text-white">
                  {count}
                </span>
              )}
            </Link>
          );
        })}
      </nav>
      <div className="m-3 rounded-lg border border-white/10 bg-white/[0.03] p-3">
        <p className="text-[11.5px] font-medium text-slate-300">Demo environment</p>
        <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
          Sample data only. Activity is saved in this browser so you can switch roles and continue the story.
        </p>
        <button
          type="button"
          onClick={() => {
            if (window.confirm("Reset all demo data to the original sample state?")) resetDemo();
          }}
          className="mt-2 inline-flex items-center gap-1.5 text-[11.5px] font-medium text-slate-300 hover:text-white"
        >
          <RotateCcw className="size-3" /> Reset demo data
        </button>
      </div>
    </div>
  );
}

function ShellSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading workspace">
      <Skeleton className="h-7 w-64" />
      <Skeleton className="h-4 w-96 max-w-full" />
      <div className="grid gap-4 pt-2 md:grid-cols-3">
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
      </div>
      <Skeleton className="h-64" />
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { hydrated } = useStore();
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => setMobileOpen(false), [pathname]);

  return (
    <div className="min-h-screen lg:pl-60">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 bg-slate-950 lg:block">{hydrated && <SidebarNav />}</aside>

      {/* Tablet / mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-950/50" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-64 bg-slate-950 shadow-xl">
            <button
              type="button"
              className="absolute right-2 top-3 rounded p-1.5 text-slate-400 hover:bg-white/10 hover:text-white"
              onClick={() => setMobileOpen(false)}
              aria-label="Close navigation"
            >
              <X className="size-4" />
            </button>
            <SidebarNav onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}

      <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-slate-200 bg-white/95 px-4 backdrop-blur sm:px-6">
        <button
          type="button"
          className="-ml-1 rounded-md p-1.5 text-slate-600 hover:bg-slate-100 lg:hidden"
          onClick={() => setMobileOpen(true)}
          aria-label="Open navigation"
        >
          <Menu className="size-5" />
        </button>
        <div className="flex-1" />
        {hydrated ? (
          <>
            <DemoGuideButton />
            <RoleSwitcher />
          </>
        ) : (
          <Skeleton className="h-8 w-80" />
        )}
      </header>

      <main className="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6">{hydrated ? children : <ShellSkeleton />}</main>
    </div>
  );
}
