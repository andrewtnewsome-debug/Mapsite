import { AlertOctagon, AlertTriangle, CheckCircle2, CircleDashed, Info, TrendingUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { HealthStatus } from "@/lib/finance/metrics";
import type { InsightSeverity } from "@/lib/finance/insights";
import type { PriorityLevel } from "@/lib/finance/aging";

const HEALTH: Record<HealthStatus, { label: string; tone: "good" | "warning" | "critical" | "neutral"; Icon: typeof CheckCircle2 }> = {
  good: { label: "Healthy", tone: "good", Icon: CheckCircle2 },
  watch: { label: "Watch", tone: "warning", Icon: AlertTriangle },
  concern: { label: "Concern", tone: "critical", Icon: AlertOctagon },
  unavailable: { label: "Not available", tone: "neutral", Icon: CircleDashed },
};

export function HealthBadge({ status }: { status: HealthStatus }) {
  const h = HEALTH[status];
  return (
    <Badge tone={h.tone}>
      <h.Icon aria-hidden />
      {h.label}
    </Badge>
  );
}

const SEVERITY: Record<InsightSeverity, { label: string; tone: "good" | "warning" | "critical" | "accent"; Icon: typeof CheckCircle2 }> = {
  concern: { label: "Concern", tone: "critical", Icon: AlertOctagon },
  watch: { label: "Watch", tone: "warning", Icon: AlertTriangle },
  info: { label: "Info", tone: "accent", Icon: Info },
  positive: { label: "Positive", tone: "good", Icon: TrendingUp },
};

export function SeverityBadge({ severity }: { severity: InsightSeverity }) {
  const s = SEVERITY[severity];
  return (
    <Badge tone={s.tone}>
      <s.Icon aria-hidden />
      {s.label}
    </Badge>
  );
}

export function SeverityIcon({ severity, className }: { severity: InsightSeverity; className?: string }) {
  const s = SEVERITY[severity];
  const color = { critical: "text-critical-text", warning: "text-warning-text", accent: "text-accent", good: "text-good-text" }[s.tone];
  return <s.Icon aria-hidden className={`${color} ${className ?? "size-4"}`} />;
}

const PRIORITY: Record<PriorityLevel, { label: string; tone: "critical" | "serious" | "neutral" }> = {
  high: { label: "High", tone: "critical" },
  medium: { label: "Medium", tone: "serious" },
  low: { label: "Low", tone: "neutral" },
};

export function PriorityBadge({ level, score }: { level: PriorityLevel; score?: number }) {
  const p = PRIORITY[level];
  return (
    <Badge tone={p.tone}>
      {p.label}
      {score != null ? <span className="tabular font-normal">{score}</span> : null}
    </Badge>
  );
}
