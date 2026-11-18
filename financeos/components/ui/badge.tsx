import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

export const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[12px] font-medium leading-4 whitespace-nowrap [&_svg]:size-3.5",
  {
    variants: {
      tone: {
        neutral: "bg-surface-2 text-text-2",
        outline: "border border-border text-text-2",
        accent: "bg-accent-soft text-accent",
        good: "bg-good-soft text-good-text",
        warning: "bg-warning-soft text-warning-text",
        serious: "bg-serious-soft text-serious-text",
        critical: "bg-critical-soft text-critical-text",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}
