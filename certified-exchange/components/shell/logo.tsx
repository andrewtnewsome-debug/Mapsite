import { brand } from "@/config/brand";
import { cn } from "@/lib/utils";

export function LogoMark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex size-8 shrink-0 items-center justify-center rounded-md bg-brand text-[12px] font-bold tracking-tight text-white",
        className,
      )}
      aria-hidden
    >
      {brand.monogram}
    </span>
  );
}

export function Logo({ dark, className }: { dark?: boolean; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <LogoMark />
      <span className="leading-tight">
        <span className={cn("block text-[15px] font-semibold tracking-tight", dark ? "text-white" : "text-slate-900")}>{brand.name}</span>
        <span className={cn("block text-[10.5px] font-medium uppercase tracking-[0.08em]", dark ? "text-slate-400" : "text-slate-500")}>
          An {brand.sponsor.short} platform
        </span>
      </span>
    </span>
  );
}
