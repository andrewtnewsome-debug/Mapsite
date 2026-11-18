import "server-only";

import type { FinancialDataset } from "@/lib/domain/types";
import { addMonths, monthOf, todayLocalIso } from "@/lib/domain/dates";
import { audit } from "@/lib/server/audit";
import { QboClient, type TokenProvider } from "./client";
import { readQboConfig, type QboConfig } from "./config";
import { clearConnection, loadConnection, saveConnection, saveSyncState, type StoredConnection } from "./connection-store";
import { QboError } from "./errors";
import { assembleQboDataset, type QboRawData } from "./assemble";
import { needsRefresh, refreshAccessToken } from "./oauth";
import { saveQboSnapshot } from "./snapshot";

/** Token provider that refreshes before expiry and after a 401, persisting rotated refresh tokens. */
export function createTokenProvider(cfg: QboConfig, initial: StoredConnection, fetchImpl: typeof fetch = fetch): TokenProvider & { current(): StoredConnection } {
  let conn = initial;
  let inflight: Promise<string> | null = null;
  const refresh = (): Promise<string> => {
    if (!inflight) {
      inflight = (async () => {
        try {
          const t = await refreshAccessToken(cfg, conn.refreshToken, fetchImpl);
          conn = { ...conn, accessToken: t.accessToken, refreshToken: t.refreshToken, accessTokenExpiresAt: t.accessTokenExpiresAt, refreshTokenExpiresAt: t.refreshTokenExpiresAt ?? conn.refreshTokenExpiresAt, lastRefreshedAt: new Date().toISOString() };
          await saveConnection(conn);
          await audit("integration.token.refreshed", { realmId: conn.realmId });
          return conn.accessToken;
        } catch (err) {
          await audit("integration.token.refresh_failed", { code: err instanceof QboError ? err.code : "unknown" });
          throw err;
        } finally {
          inflight = null;
        }
      })();
    }
    return inflight;
  };
  return {
    current: () => conn,
    getAccessToken: async () => (needsRefresh(conn.accessTokenExpiresAt) ? refresh() : conn.accessToken),
    forceRefresh: refresh,
  };
}

export interface SyncResult {
  ok: boolean;
  dataset?: FinancialDataset;
  error?: { code: string; message: string };
  requestCount?: number;
}

export async function fetchQboRawData(client: QboClient, asOfDate: string): Promise<QboRawData> {
  const start = `${addMonths(monthOf(asOfDate), -23)}-01`;
  const reportParams = { start_date: start, end_date: asOfDate, summarize_column_by: "Month", accounting_method: "Accrual" };
  const settle = async <T>(p: Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: QboError }> => {
    try {
      return { ok: true, value: await p };
    } catch (err) {
      if (err instanceof QboError && (err.code === "auth-expired" || err.code === "auth-revoked" || err.code === "auth-invalid" || err.code === "network")) throw err;
      return { ok: false, error: err instanceof QboError ? err : new QboError("api-error", (err as Error).message) };
    }
  };
  // Company info first: fails fast on authorization problems.
  const companyInfo = await client.companyInfo<unknown>();
  const [accounts, customers, vendors, invoices, bills, payments] = await Promise.all([
    settle(client.queryAll("Account")),
    settle(client.queryAll("Customer")),
    settle(client.queryAll("Vendor")),
    settle(client.queryAll("Invoice")),
    settle(client.queryAll("Bill")),
    settle(client.queryAll("Payment")),
  ]);
  const [pnl, balanceSheet, cashFlow, aging] = await Promise.all([
    settle(client.report("ProfitAndLoss", reportParams)),
    settle(client.report("BalanceSheet", reportParams)),
    settle(client.report("CashFlow", reportParams)),
    settle(client.report("AgedReceivables", { report_date: asOfDate })),
  ]);
  return { asOfDate, companyInfo, accounts, customers, vendors, invoices, bills, payments, pnl, balanceSheet, cashFlow, aging } as QboRawData;
}

export async function syncQuickBooks(fetchImpl: typeof fetch = fetch): Promise<SyncResult> {
  const cfgResult = readQboConfig();
  if (!cfgResult.ok) return { ok: false, error: { code: "not-configured", message: cfgResult.problems.join(" ") } };
  const conn = await loadConnection();
  if (!conn) return { ok: false, error: { code: "not-connected", message: new QboError("not-connected").message } };
  const attemptAt = new Date().toISOString();
  const tokens = createTokenProvider(cfgResult.config, conn, fetchImpl);
  const client = new QboClient({ realmId: conn.realmId, tokens, fetchImpl });
  const asOfDate = todayLocalIso();
  try {
    const raw = await fetchQboRawData(client, asOfDate);
    const dataset = assembleQboDataset(raw, conn.realmId, new Date().toISOString());
    await saveQboSnapshot(dataset);
    const counts = { invoices: dataset.invoices.length, bills: dataset.bills.length, payments: dataset.payments.length, customers: dataset.customers.length, accounts: dataset.accounts.length, apiRequests: client.requestCount };
    await saveSyncState({ lastSyncAt: dataset.syncedAt, lastAttemptAt: attemptAt, lastError: null, lastErrorCode: null, companyName: dataset.company.name, realmId: conn.realmId, counts });
    await audit("data.sync.completed", { realmId: conn.realmId, invoices: counts.invoices, warnings: dataset.warnings.length });
    return { ok: true, dataset, requestCount: client.requestCount };
  } catch (err) {
    const e = err instanceof QboError ? err : new QboError("api-error", (err as Error).message?.slice(0, 200));
    await saveSyncState({ lastAttemptAt: attemptAt, lastError: e.message, lastErrorCode: e.code });
    await audit("data.sync.failed", { code: e.code, status: e.status ?? null });
    if (e.code === "auth-expired" || e.code === "auth-revoked") {
      // The stored tokens can no longer be used; require a fresh connection.
      await clearConnection();
    }
    return { ok: false, error: { code: e.code, message: e.message }, requestCount: client.requestCount };
  }
}
