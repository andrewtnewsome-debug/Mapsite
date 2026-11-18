"use client";

import * as React from "react";
import { Tabs as T } from "radix-ui";
import { cn } from "@/lib/utils";

export const Tabs = T.Root;

export function TabsList({ className, ...props }: React.ComponentProps<typeof T.List>) {
  return <T.List className={cn("inline-flex items-center gap-0.5 rounded-lg bg-surface-2 p-0.5", className)} {...props} />;
}

export function TabsTrigger({ className, ...props }: React.ComponentProps<typeof T.Trigger>) {
  return (
    <T.Trigger
      className={cn(
        "inline-flex h-7 items-center justify-center rounded-md px-3 text-[13px] font-medium text-text-3 transition-colors hover:text-text data-[state=active]:bg-surface data-[state=active]:text-text data-[state=active]:shadow-card",
        className,
      )}
      {...props}
    />
  );
}

export const TabsContent = T.Content;

/** Segmented control for simple single-choice toggles (not tied to tab panels). */
export function Segmented<V extends string>({ value, onChange, options, label, className }: { value: V; onChange: (v: V) => void; options: { value: V; label: string }[]; label: string; className?: string }) {
  return (
    <div role="radiogroup" aria-label={label} className={cn("inline-flex items-center gap-0.5 rounded-lg bg-surface-2 p-0.5", className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "inline-flex h-7 items-center rounded-md px-3 text-[13px] font-medium transition-colors",
            value === o.value ? "bg-surface text-text shadow-card" : "text-text-3 hover:text-text",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
