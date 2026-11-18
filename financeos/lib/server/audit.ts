import "server-only";

import { appendLine, readLines } from "./store";
import { getRequestContext } from "./context";

/**
 * Append-only local audit log (.data/audit-log.jsonl).
 * Records security-relevant actions. Never include tokens, secrets or full financial records.
 */

export type AuditAction =
  | "integration.connect.started"
  | "integration.connect.completed"
  | "integration.connect.failed"
  | "integration.disconnected"
  | "integration.token.refreshed"
  | "integration.token.refresh_failed"
  | "data.sync.completed"
  | "data.sync.failed"
  | "settings.source.changed"
  | "settings.model.changed"
  | "forecast.assumptions.saved"
  | "collections.followup.created"
  | "collections.followup.updated"
  | "collections.followup.deleted"
  | "invoice.draft.saved"
  | "invoice.draft.deleted";

export interface AuditEvent {
  at: string;
  tenantId: string;
  userId: string;
  action: AuditAction;
  detail?: Record<string, string | number | boolean | null>;
}

export async function audit(action: AuditAction, detail?: AuditEvent["detail"]): Promise<void> {
  const ctx = getRequestContext();
  const event: AuditEvent = { at: new Date().toISOString(), tenantId: ctx.tenantId, userId: ctx.userId, action, detail };
  try {
    await appendLine("audit-log.jsonl", JSON.stringify(event));
  } catch (err) {
    console.warn(`[audit] could not write audit event ${action}: ${(err as Error).message}`);
  }
}

export async function recentAuditEvents(limit = 50): Promise<AuditEvent[]> {
  const lines = await readLines("audit-log.jsonl", limit);
  const out: AuditEvent[] = [];
  for (const line of lines) {
    try {
      out.push(JSON.parse(line) as AuditEvent);
    } catch {
      // skip malformed lines
    }
  }
  return out.reverse();
}
