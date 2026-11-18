/**
 * Read-only QuickBooks Online API client, restricted to the sandbox host.
 * Only GET requests are issued; there is no code path that writes to QuickBooks.
 */

import { assertSandboxUrl, QBO_MINOR_VERSION, QBO_SANDBOX_API_BASE } from "./config";
import { faultMessage, QboError } from "./errors";

export interface TokenProvider {
  /** Returns a valid access token, refreshing if needed. */
  getAccessToken(): Promise<string>;
  /** Forces a refresh (after a 401) and returns the new token. */
  forceRefresh(): Promise<string>;
}

export interface QboClientOptions {
  realmId: string;
  tokens: TokenProvider;
  fetchImpl?: typeof fetch;
  /** Max records per query page (QuickBooks allows up to 1000). */
  pageSize?: number;
  maxPages?: number;
  sleep?: (ms: number) => Promise<void>;
}

const ENTITY_NAMES = new Set(["Account", "Customer", "Vendor", "Invoice", "Bill", "Payment", "CompanyInfo", "Item", "Purchase", "BillPayment", "CreditMemo"]);

export class QboClient {
  private readonly realmId: string;
  private readonly tokens: TokenProvider;
  private readonly fetchImpl: typeof fetch;
  private readonly pageSize: number;
  private readonly maxPages: number;
  private readonly sleep: (ms: number) => Promise<void>;
  public requestCount = 0;

  constructor(opts: QboClientOptions) {
    if (!/^\d{1,30}$/.test(opts.realmId)) throw new QboError("bad-response", "Invalid QuickBooks company id.");
    this.realmId = opts.realmId;
    this.tokens = opts.tokens;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.pageSize = Math.min(1000, Math.max(1, opts.pageSize ?? 1000));
    this.maxPages = opts.maxPages ?? 50;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  url(path: string, params: Record<string, string> = {}): string {
    const u = new URL(`${QBO_SANDBOX_API_BASE}/company/${this.realmId}/${path.replace(/^\//, "")}`);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    u.searchParams.set("minorversion", QBO_MINOR_VERSION);
    const s = u.toString();
    assertSandboxUrl(s);
    return s;
  }

  /** GET with auth, one refresh-and-retry on 401, and backoff on 429/5xx. */
  async get<T>(path: string, params: Record<string, string> = {}): Promise<T> {
    const url = this.url(path, params);
    let token = await this.tokens.getAccessToken();
    let refreshed = false;
    for (let attempt = 0; attempt < 5; attempt++) {
      let res: Response;
      try {
        this.requestCount += 1;
        res = await this.fetchImpl(url, {
          method: "GET",
          headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
          signal: AbortSignal.timeout(45_000),
          cache: "no-store",
        });
      } catch {
        if (attempt < 2) {
          await this.sleep(500 * (attempt + 1));
          continue;
        }
        throw new QboError("network");
      }
      if (res.ok) {
        try {
          return (await res.json()) as T;
        } catch {
          throw new QboError("bad-response", `Could not read the response for ${path.split("?")[0]}.`);
        }
      }
      let body: unknown = null;
      try {
        body = await res.json();
      } catch {
        // ignore
      }
      if (res.status === 401 && !refreshed) {
        token = await this.tokens.forceRefresh();
        refreshed = true;
        continue;
      }
      if (res.status === 401) throw new QboError("auth-revoked", faultMessage(body) ?? "", 401);
      if (res.status === 403) throw new QboError("forbidden", faultMessage(body) ?? "", 403);
      if ((res.status === 429 || res.status >= 500) && attempt < 4) {
        const retryAfter = Number(res.headers.get("retry-after"));
        await this.sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(30, retryAfter) * 1000 : 1000 * 2 ** attempt);
        continue;
      }
      if (res.status === 429) throw new QboError("rate-limited", "", 429);
      throw new QboError("api-error", faultMessage(body) ?? `HTTP ${res.status} for ${path.split("?")[0]}.`, res.status);
    }
    throw new QboError("api-error", "Too many retries.");
  }

  /** Runs a query with STARTPOSITION/MAXRESULTS pagination and returns every record. */
  async queryAll<T>(entity: string, where = ""): Promise<T[]> {
    if (!ENTITY_NAMES.has(entity)) throw new QboError("bad-response", "Unsupported entity.");
    const out: T[] = [];
    for (let page = 0; page < this.maxPages; page++) {
      const start = page * this.pageSize + 1;
      const query = `SELECT * FROM ${entity}${where ? ` WHERE ${where}` : ""} STARTPOSITION ${start} MAXRESULTS ${this.pageSize}`;
      const body = await this.get<{ QueryResponse?: Record<string, unknown> }>("query", { query });
      const rows = (body.QueryResponse?.[entity] as T[] | undefined) ?? [];
      out.push(...rows);
      if (rows.length < this.pageSize) return out;
    }
    throw new QboError("api-error", `More than ${this.maxPages * this.pageSize} ${entity} records; sync stopped to stay within limits.`);
  }

  report<T>(name: "ProfitAndLoss" | "BalanceSheet" | "CashFlow" | "AgedReceivables", params: Record<string, string>): Promise<T> {
    return this.get<T>(`reports/${name}`, params);
  }

  companyInfo<T>(): Promise<T> {
    return this.get<T>(`companyinfo/${this.realmId}`);
  }
}
