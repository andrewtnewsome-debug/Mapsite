"use client";

import Link from "next/link";
import * as React from "react";
import { Popover } from "radix-ui";
import { AlertOctagon, AlertTriangle, Bell, CheckCircle2, Info } from "lucide-react";
import { cn } from "@/lib/utils";

export interface AppNotification {
  id: string;
  level: "critical" | "warning" | "info" | "positive";
  title: string;
  detail?: string;
  href?: string;
}

const ICON = { critical: AlertOctagon, warning: AlertTriangle, info: Info, positive: CheckCircle2 };
const COLOR = { critical: "text-critical-text", warning: "text-warning-text", info: "text-accent", positive: "text-good-text" };

export function Notifications({ items }: { items: AppNotification[] }) {
  const urgent = items.filter((i) => i.level === "critical" || i.level === "warning").length;
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="relative inline-flex size-9 items-center justify-center rounded-lg text-text-2 hover:bg-surface-2 hover:text-text"
          aria-label={`Alerts${urgent ? `, ${urgent} need attention` : ""}`}
        >
          <Bell className="size-4" />
          {urgent > 0 ? (
            <span className="absolute right-1.5 top-1.5 flex min-w-4 items-center justify-center rounded-full bg-critical px-1 text-[10px] font-semibold leading-4 text-white">
              {urgent}
            </span>
          ) : null}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="end" sideOffset={8} className="z-50 w-[min(92vw,380px)] rounded-xl border border-border bg-surface shadow-pop focus:outline-none">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <p className="text-sm font-semibold">Alerts</p>
            <Link href="/insights" className="text-[12px] font-medium text-accent hover:underline">
              All insights
            </Link>
          </div>
          {items.length === 0 ? (
            <p className="px-4 py-6 text-center text-[13px] text-text-3">Nothing needs your attention right now.</p>
          ) : (
            <ul className="max-h-[60vh] divide-y divide-border overflow-y-auto">
              {items.map((n) => {
                const Icon = ICON[n.level];
                const body = (
                  <div className="flex gap-3 px-4 py-3 hover:bg-surface-2/70">
                    <Icon className={cn("mt-0.5 size-4 shrink-0", COLOR[n.level])} aria-hidden />
                    <div className="min-w-0">
                      <p className="text-[13px] font-medium leading-snug text-text">{n.title}</p>
                      {n.detail ? <p className="mt-0.5 text-[12px] leading-snug text-text-3">{n.detail}</p> : null}
                    </div>
                  </div>
                );
                return <li key={n.id}>{n.href ? <Popover.Close asChild><Link href={n.href}>{body}</Link></Popover.Close> : body}</li>;
              })}
            </ul>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
