"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import * as React from "react";
import { Dialog } from "radix-ui";
import { Menu, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { NAV_GROUPS, SETTINGS_ITEM, type NavItem } from "./nav";
import { Logo } from "./logo";

function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

function NavLink({ item, onNavigate }: { item: NavItem; onNavigate?: () => void }) {
  const pathname = usePathname();
  const active = isActive(pathname, item.href);
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex h-8 items-center gap-2.5 rounded-lg px-2.5 text-[13.5px] font-medium transition-colors",
        active ? "bg-surface text-text shadow-card ring-1 ring-border" : "text-text-2 hover:bg-surface-2 hover:text-text",
      )}
    >
      <Icon className={cn("size-4 shrink-0", active ? "text-text" : "text-text-3")} aria-hidden />
      {item.label}
    </Link>
  );
}

function SidebarBody({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 items-center gap-2.5 px-4">
        <Logo className="size-7" />
        <div className="leading-tight">
          <p className="text-[15px] font-semibold tracking-tight">FinanceOS</p>
          <p className="text-[11px] text-text-3">AI finance employee</p>
        </div>
      </div>
      <nav aria-label="Primary" className="flex-1 space-y-5 overflow-y-auto px-3 pb-4 pt-2">
        {NAV_GROUPS.map((g) => (
          <div key={g.label}>
            <p className="px-2.5 pb-1.5 text-[11px] font-medium uppercase tracking-wider text-text-3">{g.label}</p>
            <div className="space-y-0.5">
              {g.items.map((item) => (
                <NavLink key={item.href} item={item} onNavigate={onNavigate} />
              ))}
            </div>
          </div>
        ))}
      </nav>
      <div className="border-t border-border px-3 py-3">
        <NavLink item={SETTINGS_ITEM} onNavigate={onNavigate} />
        <p className="mt-3 px-2.5 text-[11px] leading-snug text-text-3">Local prototype. Runs on this computer only; no data leaves it except QuickBooks Sandbox API calls.</p>
      </div>
    </div>
  );
}

export function Sidebar() {
  return (
    <aside aria-label="Sidebar" className="no-print fixed inset-y-0 left-0 z-30 hidden w-60 border-r border-border bg-bg lg:block">
      <SidebarBody />
    </aside>
  );
}

export function MobileNav() {
  const [open, setOpen] = React.useState(false);
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button type="button" className="inline-flex size-9 items-center justify-center rounded-lg text-text-2 hover:bg-surface-2 lg:hidden" aria-label="Open navigation">
          <Menu className="size-5" />
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40 lg:hidden" />
        <Dialog.Content className="fixed inset-y-0 left-0 z-50 w-72 border-r border-border bg-bg shadow-pop focus:outline-none lg:hidden">
          <Dialog.Title className="sr-only">Navigation</Dialog.Title>
          <Dialog.Description className="sr-only">FinanceOS sections</Dialog.Description>
          <Dialog.Close asChild>
            <button type="button" className="absolute right-3 top-3 inline-flex size-8 items-center justify-center rounded-lg text-text-2 hover:bg-surface-2" aria-label="Close navigation">
              <X className="size-4" />
            </button>
          </Dialog.Close>
          <SidebarBody onNavigate={() => setOpen(false)} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
