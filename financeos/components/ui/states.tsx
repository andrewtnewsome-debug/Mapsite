import * as React from "react";
import { AlertTriangle, Inbox } from "lucide-react";
import { cn } from "@/lib/utils";

export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
  className,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-3 px-6 py-12 text-center", className)}>
      <div className="flex size-10 items-center justify-center rounded-full bg-surface-2 text-text-3">
        <Icon className="size-5" />
      </div>
      <div className="max-w-md">
        <p className="text-sm font-medium text-text">{title}</p>
        {description ? <div className="mt-1 text-[13px] leading-relaxed text-text-3">{description}</div> : null}
      </div>
      {action}
    </div>
  );
}

export function ErrorState({ title = "Something went wrong", description, action, className }: { title?: string; description?: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <div role="alert" className={cn("flex items-start gap-3 rounded-xl border border-critical/30 bg-critical-soft px-4 py-3", className)}>
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-critical-text" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-critical-text">{title}</p>
        {description ? <div className="mt-0.5 text-[13px] text-text-2">{description}</div> : null}
        {action ? <div className="mt-2">{action}</div> : null}
      </div>
    </div>
  );
}

export function Notice({ tone = "info", title, children, className }: { tone?: "info" | "warning" | "critical"; title?: string; children: React.ReactNode; className?: string }) {
  const styles = {
    info: "border-border bg-surface-2 text-text-2",
    warning: "border-warning/40 bg-warning-soft text-text-2",
    critical: "border-critical/30 bg-critical-soft text-text-2",
  }[tone];
  return (
    <div className={cn("rounded-lg border px-3.5 py-2.5 text-[13px] leading-relaxed", styles, className)}>
      {title ? <p className="font-medium text-text">{title}</p> : null}
      <div>{children}</div>
    </div>
  );
}
