import { Database, FlaskConical } from "lucide-react";
import type { DataSourceKind } from "@/lib/domain/types";
import { Badge } from "@/components/ui/badge";

/** Always-visible indicator distinguishing fictional demo data from QuickBooks Sandbox data. */
export function SourceBadge({ source, className }: { source: DataSourceKind; className?: string }) {
  return source === "demo" ? (
    <Badge tone="warning" className={className} title="Fictional demonstration data">
      <FlaskConical aria-hidden />
      Demo data
    </Badge>
  ) : (
    <Badge tone="accent" className={className} title="Data synced from your QuickBooks Online sandbox company">
      <Database aria-hidden />
      QuickBooks Sandbox
    </Badge>
  );
}
