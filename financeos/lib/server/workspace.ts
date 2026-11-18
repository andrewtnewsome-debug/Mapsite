import "server-only";

import { cache } from "react";
import { connection } from "next/server";
import type { DataSourceKind, FinancialDataset } from "@/lib/domain/types";
import { todayLocalIso } from "@/lib/domain/dates";
import { buildDemoDataset } from "@/lib/demo/generate";
import { readQboConfig } from "@/lib/qbo/config";
import { loadConnection, loadSyncState } from "@/lib/qbo/connection-store";
import { loadQboSnapshot } from "@/lib/qbo/snapshot";
import { getSettings } from "./settings";

export interface QboStatus {
  configured: boolean;
  configProblems: string[];
  connected: boolean;
  realmId: string | null;
  companyName: string | null;
  connectedAt: string | null;
  accessTokenExpiresAt: string | null;
  refreshTokenExpiresAt: string | null;
  lastSyncAt: string | null;
  lastAttemptAt: string | null;
  lastError: string | null;
  lastErrorCode: string | null;
  counts: Record<string, number>;
}

export type WorkspaceStatus =
  | { kind: "ready" }
  | { kind: "qbo-not-configured"; problems: string[] }
  | { kind: "qbo-not-connected" }
  | { kind: "qbo-not-synced"; lastError: string | null };

export interface Workspace {
  source: DataSourceKind;
  /** null when the selected source has no data yet. Demo data is never substituted. */
  dataset: FinancialDataset | null;
  status: WorkspaceStatus;
  qbo: QboStatus;
}

let demoCache: { date: string; dataset: FinancialDataset } | null = null;

export function demoDataset(asOf = todayLocalIso()): FinancialDataset {
  if (!demoCache || demoCache.date !== asOf) {
    demoCache = { date: asOf, dataset: buildDemoDataset(asOf) };
  }
  return demoCache.dataset;
}

export async function getQboStatus(): Promise<QboStatus> {
  const cfg = readQboConfig();
  const [conn, sync] = await Promise.all([loadConnection(), loadSyncState()]);
  return {
    configured: cfg.ok,
    configProblems: cfg.ok ? [] : cfg.problems,
    connected: conn != null,
    realmId: conn?.realmId ?? null,
    companyName: sync.companyName,
    connectedAt: conn?.connectedAt ?? null,
    accessTokenExpiresAt: conn?.accessTokenExpiresAt ?? null,
    refreshTokenExpiresAt: conn?.refreshTokenExpiresAt ?? null,
    lastSyncAt: sync.lastSyncAt,
    lastAttemptAt: sync.lastAttemptAt,
    lastError: sync.lastError,
    lastErrorCode: sync.lastErrorCode,
    counts: sync.counts,
  };
}

/** Loads the active data source for this request (deduplicated per request). */
export const loadWorkspace = cache(async function loadWorkspace(): Promise<Workspace> {
  await connection(); // always render per request from local data
  const [settings, qbo] = await Promise.all([getSettings(), getQboStatus()]);

  if (settings.activeSource === "demo") {
    return { source: "demo", dataset: demoDataset(), status: { kind: "ready" }, qbo };
  }

  const snapshot = await loadQboSnapshot();
  if (snapshot && qbo.connected && snapshot.company.realmId === qbo.realmId) {
    return { source: "quickbooks-sandbox", dataset: snapshot, status: { kind: "ready" }, qbo };
  }
  if (!qbo.configured) {
    return { source: "quickbooks-sandbox", dataset: null, status: { kind: "qbo-not-configured", problems: qbo.configProblems }, qbo };
  }
  if (!qbo.connected) {
    return { source: "quickbooks-sandbox", dataset: null, status: { kind: "qbo-not-connected" }, qbo };
  }
  return { source: "quickbooks-sandbox", dataset: null, status: { kind: "qbo-not-synced", lastError: qbo.lastError }, qbo };
});

/** For API routes: the active dataset or null. */
export async function activeDataset(): Promise<{ source: DataSourceKind; dataset: FinancialDataset | null }> {
  const ws = await loadWorkspace();
  return { source: ws.source, dataset: ws.dataset };
}
