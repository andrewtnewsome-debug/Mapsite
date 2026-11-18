"use client";

import * as React from "react";
import { Tooltip as T } from "radix-ui";
import { Info } from "lucide-react";
import { cn } from "@/lib/utils";

export function TooltipProvider({ children }: { children: React.ReactNode }) {
  return <T.Provider delayDuration={150}>{children}</T.Provider>;
}

export function Tooltip({ content, children, side = "top" }: { content: React.ReactNode; children: React.ReactNode; side?: "top" | "bottom" | "left" | "right" }) {
  return (
    <T.Root>
      <T.Trigger asChild>{children}</T.Trigger>
      <T.Portal>
        <T.Content side={side} sideOffset={6} className="z-50 max-w-xs rounded-lg border border-border bg-surface px-3 py-2 text-[12px] leading-relaxed text-text-2 shadow-pop">
          {content}
        </T.Content>
      </T.Portal>
    </T.Root>
  );
}

export function InfoTip({ content, label = "More information", className }: { content: React.ReactNode; label?: string; className?: string }) {
  return (
    <Tooltip content={content}>
      <button type="button" aria-label={label} className={cn("inline-flex size-4 items-center justify-center rounded-full text-text-3 hover:text-text-2", className)}>
        <Info className="size-3.5" aria-hidden />
      </button>
    </Tooltip>
  );
}
