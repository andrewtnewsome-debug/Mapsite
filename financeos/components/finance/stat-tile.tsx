import Link from "next/link";
import * as React from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { NOT_AVAILABLE } from "@/lib/format";
import { InfoTip } from "@/components/ui/tooltip";

export function StatTile({
  label,
  value,
  delta,
  caption,
  info,
  href,
  emphasis,
  className,
}: {
  label: string;
  value: string;
  delta?: React.ReactNode;
  caption?: React.ReactNode;
  info?: React.ReactNode;
  href?: string;
  emphasis?: "critical" | "warning";
  className?: string;
}) {
  const unavailable = value === NOT_AVAILABLE;
  const body = (
    <div
      className={cn(
        "group relative flex h-full flex-col rounded-xl border border-border bg-surface p-4 shadow-card transition-colors",
        href && "hover:border-border-strong",
        className,
      )}
    >
      <div className="flex items-center gap-1.5">
        {emphasis ? <span aria-hidden className={cn("size-1.5 rounded-full", emphasis === "critical" ? "bg-critical" : "bg-warning")} /> : null}
        <p className="text-[13px] font-medium text-text-2">{label}</p>
        {info ? <InfoTip content={info} label={`About ${label}`} /> : null}
        {href ? <ChevronRight className="ml-auto size-4 text-text-3 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden /> : null}
      </div>
      <p className={cn("mt-2 text-[26px] font-semibold leading-8 tracking-tight", unavailable ? "text-lg text-text-3" : "text-text")}>{value}</p>
      <div className="mt-1 flex min-h-5 flex-wrap items-center gap-x-2 gap-y-0.5">
        {delta}
        {caption ? <span className="text-[12px] text-text-3">{caption}</span> : null}
      </div>
    </div>
  );
  return href ? (
    <Link href={href} className="block rounded-xl focus-visible:outline-2 focus-visible:outline-ring">
      {body}
    </Link>
  ) : (
    body
  );
}
