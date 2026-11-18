import "server-only";

import type { AppNotification } from "@/components/layout/notifications";
import { generateInsights } from "@/lib/finance/insights";
import type { Workspace } from "./workspace";

export function buildNotifications(ws: Workspace): AppNotification[] {
  const out: AppNotification[] = [];
  if (ws.source === "quickbooks-sandbox") {
    if (ws.status.kind === "qbo-not-configured") out.push({ id: "qbo-config", level: "warning", title: "QuickBooks keys are not configured", detail: "Add your Intuit development keys to .env.local.", href: "/settings" });
    if (ws.status.kind === "qbo-not-connected") out.push({ id: "qbo-connect", level: "warning", title: "QuickBooks Sandbox is not connected", detail: "Connect it from Settings, or switch back to the Demo Company.", href: "/settings" });
    if (ws.qbo.lastError) out.push({ id: "qbo-error", level: "critical", title: "Last QuickBooks sync failed", detail: ws.qbo.lastError, href: "/settings" });
  }
  if (ws.dataset) {
    for (const w of ws.dataset.warnings.slice(0, 3)) out.push({ id: `dq-${w.slice(0, 24)}`, level: "info", title: "Data quality", detail: w, href: "/settings" });
    for (const i of generateInsights(ws.dataset).filter((x) => x.severity === "concern" || x.severity === "watch").slice(0, 6)) {
      out.push({ id: i.id, level: i.severity === "concern" ? "critical" : "warning", title: i.title, detail: i.trigger, href: "/insights" });
    }
  }
  return out;
}
