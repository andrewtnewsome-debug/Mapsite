import { formatIsoDate } from "@/lib/domain/dates";
import { formatTimestamp } from "@/lib/format";
import type { Workspace } from "@/lib/server/workspace";
import { MobileNav } from "./sidebar";
import { SourceBadge } from "./source-badge";
import { SourceSwitcher } from "./source-switcher";
import { ThemeToggle } from "./theme-toggle";
import { Notifications, type AppNotification } from "./notifications";

export function Topbar({ workspace, notifications }: { workspace: Workspace; notifications: AppNotification[] }) {
  const ds = workspace.dataset;
  const companyName = ds?.company.name ?? (workspace.source === "demo" ? "Demo Company" : workspace.qbo.companyName ?? "QuickBooks Sandbox");
  const syncText = ds
    ? ds.source === "demo"
      ? "Demo data generated locally"
      : `Last synced ${formatTimestamp(ds.syncedAt)}`
    : workspace.source === "quickbooks-sandbox"
      ? workspace.qbo.lastSyncAt
        ? `Last synced ${formatTimestamp(workspace.qbo.lastSyncAt)}`
        : "Not synced yet"
      : "";
  return (
    <header className="no-print sticky top-0 z-20 border-b border-border bg-bg/85 backdrop-blur supports-[backdrop-filter]:bg-bg/75">
      <div className="flex h-14 items-center gap-3 px-4 sm:px-6">
        <MobileNav />
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="truncate text-sm font-semibold text-text">{companyName}</p>
              <SourceBadge source={workspace.source} className="hidden sm:inline-flex" />
            </div>
            <p className="truncate text-[12px] text-text-3">
              {ds ? <>Reporting date {formatIsoDate(ds.asOfDate)}</> : "No data loaded"}
              {syncText ? <span className="hidden md:inline"> · {syncText}</span> : null}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1 sm:gap-2">
          <div className="hidden sm:block">
            <SourceSwitcher source={workspace.source} />
          </div>
          <Notifications items={notifications} />
          <ThemeToggle />
        </div>
      </div>
      <div className="flex items-center justify-between gap-2 border-t border-border px-4 py-2 sm:hidden">
        <SourceBadge source={workspace.source} />
        <SourceSwitcher source={workspace.source} />
      </div>
    </header>
  );
}
