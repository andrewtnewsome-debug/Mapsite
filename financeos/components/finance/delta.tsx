import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatSignedPercent } from "@/lib/format";

/** Signed change with direction icon. Color reflects whether the move is favorable, never color alone. */
export function Delta({ value, goodWhenUp = true, suffix, className }: { value: number | null; goodWhenUp?: boolean; suffix?: string; className?: string }) {
  if (value == null || !Number.isFinite(value)) {
    return <span className={cn("text-[12px] text-text-3", className)}>No comparison</span>;
  }
  const flat = Math.abs(value) < 0.0005;
  const up = value > 0;
  const favorable = flat ? null : up === goodWhenUp;
  const Icon = flat ? Minus : up ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 text-[12px] font-medium",
        favorable == null ? "text-text-3" : favorable ? "text-good-text" : "text-critical-text",
        className,
      )}
    >
      <Icon className="size-3.5" aria-hidden />
      <span>{formatSignedPercent(value)}</span>
      {suffix ? <span className="font-normal text-text-3">&nbsp;{suffix}</span> : null}
      <span className="sr-only">{favorable == null ? "(no change)" : favorable ? "(favorable)" : "(unfavorable)"}</span>
    </span>
  );
}
