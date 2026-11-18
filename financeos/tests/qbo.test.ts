import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assembleQboDataset, type QboRawData } from "@/lib/qbo/assemble";
import { QboClient } from "@/lib/qbo/client";
import { assertSandboxUrl, INTUIT_AUTHORIZE_URL, INTUIT_TOKEN_URL, readQboConfig, type QboConfig } from "@/lib/qbo/config";
import { faultMessage, QboError } from "@/lib/qbo/errors";
import { buildAuthorizeUrl, exchangeAuthorizationCode, needsRefresh, refreshAccessToken } from "@/lib/qbo/oauth";
import { mapBills, mapInvoices, mapPayments } from "@/lib/qbo/parse-entities";
import { parseAgedReceivables, parseBalanceSheet, parseCashFlow, parseProfitAndLoss, periodColumns } from "@/lib/qbo/parse-reports";
import { createOAuthState, validateOAuthState } from "@/lib/qbo/state";
import { cashPosition, receivablesSnapshot } from "@/lib/finance/metrics";
import { summarizeBalanceSheet, summarizeCashFlow, summarizePnl } from "@/lib/finance/statements";
import { runTool } from "@/lib/ai/tools";
import * as fx from "./helpers/qbo-fixtures";

const cfg: QboConfig = { clientId: "ABclientid", clientSecret: "secret-xyz", redirectUri: "http://localhost:3000/api/auth/callback", environment: "sandbox" };
const AS_OF = "2026-11-18";

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
}

describe("configuration", () => {
  it("requires credentials and rejects non-sandbox environments", () => {
    const r = readQboConfig({});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problems.join(" ")).toMatch(/INTUIT_CLIENT_ID/);
    const prod = readQboConfig({ INTUIT_CLIENT_ID: "a", INTUIT_CLIENT_SECRET: "b", INTUIT_ENVIRONMENT: "production" });
    expect(prod.ok).toBe(false);
    const remote = readQboConfig({ INTUIT_CLIENT_ID: "a", INTUIT_CLIENT_SECRET: "b", INTUIT_REDIRECT_URI: "https://example.com/api/auth/callback" });
    expect(remote.ok).toBe(false);
    const ok = readQboConfig({ INTUIT_CLIENT_ID: "a", INTUIT_CLIENT_SECRET: "b" });
    expect(ok.ok && ok.config.redirectUri).toBe("http://localhost:3000/api/auth/callback");
  });

  it("refuses API calls to any host other than the sandbox", () => {
    expect(() => assertSandboxUrl("https://sandbox-quickbooks.api.intuit.com/v3/company/1/query")).not.toThrow();
    expect(() => assertSandboxUrl("https://quickbooks.api.intuit.com/v3/company/1/query")).toThrow();
    expect(() => assertSandboxUrl("http://sandbox-quickbooks.api.intuit.com/v3/company/1/query")).toThrow();
  });
});

describe("OAuth state", () => {
  const secret = Buffer.alloc(32, 7);
  it("accepts the state it issued", () => {
    const { state, cookieValue } = createOAuthState(secret, 1_000);
    expect(validateOAuthState(secret, state, cookieValue, 2_000)).toEqual({ ok: true });
  });
  it("rejects missing, mismatched, tampered and expired state", () => {
    const { state, cookieValue } = createOAuthState(secret, 1_000);
    expect(validateOAuthState(secret, null, cookieValue)).toEqual({ ok: false, reason: "missing" });
    expect(validateOAuthState(secret, state, undefined)).toEqual({ ok: false, reason: "missing" });
    expect(validateOAuthState(secret, "other", cookieValue, 2_000)).toEqual({ ok: false, reason: "mismatch" });
    const [s, exp] = cookieValue.split(".");
    expect(validateOAuthState(secret, state, `${s}.${Number(exp) + 999999}.forged`, 2_000)).toEqual({ ok: false, reason: "bad-signature" });
    expect(validateOAuthState(Buffer.alloc(32, 8), state, cookieValue, 2_000)).toEqual({ ok: false, reason: "bad-signature" });
    expect(validateOAuthState(secret, state, cookieValue, 1_000 + 11 * 60 * 1000)).toEqual({ ok: false, reason: "expired" });
    expect(validateOAuthState(secret, state, "garbage", 2_000)).toEqual({ ok: false, reason: "malformed" });
  });
  it("issues unique states", () => {
    expect(createOAuthState(secret).state).not.toBe(createOAuthState(secret).state);
  });
});

describe("OAuth token flow", () => {
  it("builds the Intuit authorization URL with accounting scope", () => {
    const u = new URL(buildAuthorizeUrl(cfg, "st123"));
    expect(`${u.origin}${u.pathname}`).toBe(INTUIT_AUTHORIZE_URL);
    expect(u.searchParams.get("scope")).toBe("com.intuit.quickbooks.accounting");
    expect(u.searchParams.get("response_type")).toBe("code");
    expect(u.searchParams.get("redirect_uri")).toBe(cfg.redirectUri);
    expect(u.searchParams.get("state")).toBe("st123");
    expect(u.toString()).not.toContain(cfg.clientSecret);
  });

  it("exchanges an authorization code using Basic auth and computes expiries", async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    const fetchImpl = (async (url: string, init: RequestInit) => {
      seen = { url, init };
      return jsonResponse({ token_type: "bearer", access_token: "AT1", refresh_token: "RT1", expires_in: 3600, x_refresh_token_expires_in: 8726400 });
    }) as unknown as typeof fetch;
    const t = await exchangeAuthorizationCode(cfg, "code-1", fetchImpl, Date.parse("2026-11-18T00:00:00Z"));
    expect(seen!.url).toBe(INTUIT_TOKEN_URL);
    expect((seen!.init.headers as Record<string, string>).Authorization).toBe(`Basic ${Buffer.from("ABclientid:secret-xyz").toString("base64")}`);
    expect(String(seen!.init.body)).toContain("grant_type=authorization_code");
    expect(t).toEqual({ accessToken: "AT1", refreshToken: "RT1", accessTokenExpiresAt: "2026-11-18T01:00:00.000Z", refreshTokenExpiresAt: "2027-02-27T00:00:00.000Z" });
  });

  it("maps token errors to explicit codes", async () => {
    const respond = (status: number, body: unknown) => (async () => jsonResponse(body, status)) as unknown as typeof fetch;
    await expect(refreshAccessToken(cfg, "RT", respond(400, { error: "invalid_grant" }))).rejects.toMatchObject({ code: "auth-expired" });
    await expect(exchangeAuthorizationCode(cfg, "c", respond(400, { error: "invalid_grant" }))).rejects.toMatchObject({ code: "auth-revoked" });
    await expect(refreshAccessToken(cfg, "RT", respond(401, { error: "invalid_client" }))).rejects.toMatchObject({ code: "auth-invalid" });
    await expect(refreshAccessToken(cfg, "RT", respond(200, { access_token: "x" }))).rejects.toMatchObject({ code: "bad-response" });
    await expect(refreshAccessToken(cfg, "RT", (async () => Promise.reject(new TypeError("fetch failed"))) as unknown as typeof fetch)).rejects.toMatchObject({ code: "network" });
  });

  it("refreshes shortly before expiry", () => {
    const now = Date.parse("2026-11-18T00:00:00Z");
    expect(needsRefresh("2026-11-18T00:30:00Z", now)).toBe(false);
    expect(needsRefresh("2026-11-18T00:04:00Z", now)).toBe(true);
    expect(needsRefresh("not a date", now)).toBe(true);
  });
});

describe("API client", () => {
  function tokens() {
    let n = 0;
    return { refreshes: () => n, getAccessToken: async () => "AT-old", forceRefresh: async () => (n += 1, "AT-new") };
  }

  it("paginates queries with STARTPOSITION and MAXRESULTS on the sandbox host only", async () => {
    const urls: string[] = [];
    const methods: string[] = [];
    const data = [{ Id: "1" }, { Id: "2" }, { Id: "3" }];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      urls.push(url);
      methods.push(init.method ?? "GET");
      const q = new URL(url).searchParams.get("query")!;
      const start = Number(/STARTPOSITION (\d+)/.exec(q)![1]);
      return jsonResponse({ QueryResponse: { Invoice: data.slice(start - 1, start + 1), startPosition: start, maxResults: 2 } });
    }) as unknown as typeof fetch;
    const client = new QboClient({ realmId: "9130", tokens: tokens(), fetchImpl, pageSize: 2 });
    const rows = await client.queryAll<{ Id: string }>("Invoice");
    expect(rows.map((r) => r.Id)).toEqual(["1", "2", "3"]);
    expect(urls).toHaveLength(2);
    expect(urls.every((u) => u.startsWith("https://sandbox-quickbooks.api.intuit.com/v3/company/9130/query?"))).toBe(true);
    expect(urls.every((u) => new URL(u).searchParams.get("minorversion") === "75")).toBe(true);
    expect(methods.every((m) => m === "GET")).toBe(true);
  });

  it("handles an empty QueryResponse", async () => {
    const client = new QboClient({ realmId: "1", tokens: tokens(), fetchImpl: (async () => jsonResponse({ QueryResponse: {} })) as unknown as typeof fetch });
    expect(await client.queryAll("Bill")).toEqual([]);
  });

  it("refreshes the token once after a 401 and retries", async () => {
    const auths: string[] = [];
    const tk = tokens();
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      auths.push((init.headers as Record<string, string>).Authorization);
      return auths.length === 1 ? jsonResponse(fx.fault401, 401) : jsonResponse(fx.companyInfo);
    }) as unknown as typeof fetch;
    const client = new QboClient({ realmId: "1", tokens: tk, fetchImpl });
    expect(await client.companyInfo()).toEqual(fx.companyInfo);
    expect(auths).toEqual(["Bearer AT-old", "Bearer AT-new"]);
    expect(tk.refreshes()).toBe(1);
  });

  it("reports revoked access when a 401 persists after refresh", async () => {
    const client = new QboClient({ realmId: "1", tokens: tokens(), fetchImpl: (async () => jsonResponse(fx.fault401, 401)) as unknown as typeof fetch });
    await expect(client.companyInfo()).rejects.toMatchObject({ code: "auth-revoked" });
  });

  it("backs off on rate limiting and surfaces Fault details", async () => {
    let calls = 0;
    const sleeps: number[] = [];
    const fetchImpl = (async () => (++calls === 1 ? jsonResponse({}, 429, { "Retry-After": "2" }) : jsonResponse(fx.fault400, 400))) as unknown as typeof fetch;
    const client = new QboClient({ realmId: "1", tokens: tokens(), fetchImpl, sleep: async (ms) => void sleeps.push(ms) });
    const err = await client.queryAll("Invoice").catch((e) => e);
    expect(sleeps).toEqual([2000]);
    expect(err).toBeInstanceOf(QboError);
    expect(err.code).toBe("api-error");
    expect(err.message).toContain("Invalid query");
    expect(faultMessage(fx.fault400)).toContain("code 4000");
  });

  it("rejects invalid realm ids", () => {
    expect(() => new QboClient({ realmId: "../../evil", tokens: tokens() })).toThrow(QboError);
  });
});

describe("report parsing", () => {
  it("reads month columns and skips the account and total columns", () => {
    const cols = periodColumns(fx.pnlReport);
    expect(cols.map((c) => c.title)).toEqual(["Sep 2026", "Oct 2026", "Nov 1-18, 2026"]);
    expect(cols[2]).toMatchObject({ startDate: "2026-11-01", endDate: "2026-11-18" });
  });

  it("parses a nested Profit and Loss into monthly lines that tie to QuickBooks net income", () => {
    const { months, warnings } = parseProfitAndLoss(fx.pnlReport, AS_OF);
    expect(warnings).toEqual([]);
    expect(months.map((m) => m.month)).toEqual(["2026-09", "2026-10", "2026-11"]);
    expect(months[2].isPartial).toBe(true);
    expect(months[1].isPartial).toBe(false);
    const sep = summarizePnl([months[0]]);
    expect(sep.revenue).toBe(6000);
    expect(sep.cogs).toBe(1500);
    expect(sep.operatingExpenses).toBe(1220);
    expect(sep.otherExpense).toBe(80);
    expect(sep.netIncome).toBe(3200);
    // sub-accounts are leaves; the parent section total is not double counted
    expect(months[0].lines.find((l) => l.account === "Job Materials")?.amount).toBe(2000);
    expect(months[0].lines.some((l) => l.account === "Landscaping Services")).toBe(false);
    expect(summarizePnl([months[2]]).netIncome).toBe(640);
  });

  it("warns when parsed lines do not tie to the reported net income", () => {
    const broken = JSON.parse(JSON.stringify(fx.pnlReport));
    broken.Rows.Row.at(-1).Summary.ColData[1].value = "9999.00";
    expect(parseProfitAndLoss(broken, AS_OF).warnings[0]).toMatch(/2026-09/);
  });

  it("parses a Balance Sheet into sections that balance", () => {
    const { snapshots, warnings } = parseBalanceSheet(fx.balanceSheetReport);
    expect(warnings).toEqual([]);
    expect(snapshots.map((s) => s.date)).toEqual(["2026-09-30", "2026-10-31", "2026-11-18"]);
    const nov = summarizeBalanceSheet(snapshots[2]);
    expect(nov.cash).toBe(2600);
    expect(nov.accountsReceivable).toBe(5281.52);
    expect(nov.creditCards).toBe(157.72);
    expect(nov.longTermLiabilities).toBe(3800);
    expect(nov.totalAssets).toBe(21381.52);
    expect(nov.balances).toBe(true);
  });

  it("parses the Cash Flow statement with beginning and ending cash", () => {
    const { months } = parseCashFlow(fx.cashFlowReport, AS_OF);
    const oct = summarizeCashFlow([months[1]]);
    expect(oct.operating).toBe(3815);
    expect(oct.financing).toBe(-3515);
    expect(oct.netChange).toBe(300);
    expect(months[1].beginningCash).toBe(2000);
    expect(months[1].endingCash).toBe(2300);
    expect(months[2].isPartial).toBe(true);
  });

  it("parses A/R Aging summary totals", () => {
    expect(parseAgedReceivables(fx.agedReceivablesReport, AS_OF)).toEqual({ asOfDate: AS_OF, current: 694, days1to30: 239, days31to60: 0, days61to90: 0, over90: 0, total: 933 });
    expect(parseAgedReceivables({}, AS_OF)).toBeNull();
  });

  it("tolerates empty and malformed reports", () => {
    expect(parseProfitAndLoss({}, AS_OF).months).toEqual([]);
    expect(parseBalanceSheet({ Rows: { Row: [{ type: "Data" }] } }).snapshots).toEqual([]);
    expect(parseCashFlow({ Columns: { Column: [] } }, AS_OF).months).toEqual([]);
  });
});

describe("entity mapping", () => {
  it("maps invoices, skipping incomplete records and handling partial payments and missing due dates", () => {
    const stats = { skipped: 0, missingDueDates: 0 };
    const inv = mapInvoices(fx.invoices, stats);
    expect(inv).toHaveLength(4);
    expect(stats.skipped).toBe(1);
    expect(stats.missingDueDates).toBe(1);
    expect(inv.find((i) => i.id === "129")).toMatchObject({ totalAmount: 1000, balance: 400, customerName: "Cool Cars" });
    expect(inv.find((i) => i.id === "130")!.lines).toEqual([{ description: "Rock Fountain", itemName: "Rock Fountain", quantity: 1, unitPrice: 275, amount: 362.07 }]);
  });

  it("maps payments to invoice applications and bills to categories", () => {
    const stats = { skipped: 0, missingDueDates: 0 };
    const p = mapPayments(fx.payments, stats);
    expect(p[1]).toMatchObject({ amount: 650, unappliedAmount: 50, applied: [{ invoiceId: "129", amount: 600 }] });
    expect(mapBills(fx.bills, stats)[0].category).toBe("Job Expenses:Job Materials");
  });
});

describe("dataset assembly", () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), "financeos-test-"));
    process.env.FINANCEOS_DATA_DIR = dir;
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const ok = <T>(value: T) => ({ ok: true as const, value });
  const raw: QboRawData = {
    asOfDate: AS_OF,
    companyInfo: fx.companyInfo,
    accounts: ok(fx.accounts),
    customers: ok(fx.customers),
    vendors: ok([]),
    invoices: ok(fx.invoices),
    bills: ok(fx.bills),
    payments: ok(fx.payments),
    pnl: ok(fx.pnlReport),
    balanceSheet: ok(fx.balanceSheetReport),
    cashFlow: ok(fx.cashFlowReport),
    aging: ok(fx.agedReceivablesReport),
  };

  it("builds a sandbox dataset the finance engine and AI tools can use", () => {
    const ds = assembleQboDataset(raw, "9130", "2026-11-18T18:00:00.000Z");
    expect(ds.source).toBe("quickbooks-sandbox");
    expect(ds.company).toMatchObject({ id: "qbo-9130", name: "Sandbox Company_US_1", realmId: "9130", fiscalYearStartMonth: 1 });
    expect(cashPosition(ds)).toMatchObject({ amount: 2600, basis: "balance-sheet" });
    const ar = receivablesSnapshot(ds)!;
    expect(ar.aging.total).toBeCloseTo(1001.07);
    expect(ar.aging.partiallyPaidCount).toBe(1);
    expect(ds.sourceArAging?.total).toBe(933);
    expect(ds.warnings.some((w) => w.includes("skipped"))).toBe(true);
    expect(ds.warnings.some((w) => w.includes("no due date"))).toBe(true);
    expect(ds.warnings.some((w) => w.includes("unapplied"))).toBe(true);
    expect(ds.managementAssumptions).toBeNull();
    const pnl = runTool(ds, { id: "profit_and_loss", params: { period: "last-month" } });
    expect(pnl.facts.find((f) => f.label.startsWith("Net income, October 2026"))?.value).toBe(3915);
  });

  it("records partial failures as coverage gaps instead of failing", () => {
    const err = { ok: false as const, error: { code: "forbidden" as const, message: "QuickBooks denied access to this data." } };
    const ds = assembleQboDataset({ ...raw, cashFlow: err, bills: err }, "9130", "t");
    expect(ds.coverage.cashFlow).toBe(false);
    expect(ds.coverage.bills).toBe(false);
    expect(ds.warnings.some((w) => w.startsWith("Cash Flow report could not be loaded"))).toBe(true);
    expect(runTool(ds, { id: "payables_summary", params: {} }).available).toBe(false);
  });
});

describe("OAuth state replay protection", () => {
  it("accepts a state value only once", async () => {
    const { consumeOAuthState } = await import("@/lib/qbo/state");
    expect(consumeOAuthState("abc", 1_000)).toBe(true);
    expect(consumeOAuthState("abc", 2_000)).toBe(false);
    expect(consumeOAuthState("def", 2_000)).toBe(true);
  });
});

describe("localhost host guard", () => {
  it("allows loopback hosts and rejects rebinding hosts", async () => {
    const { isAllowedHost } = await import("@/lib/host-guard");
    for (const h of ["localhost:3000", "127.0.0.1:3000", "[::1]:3000", "LOCALHOST"]) expect(isAllowedHost(h)).toBe(true);
    for (const h of ["evil.example:3000", "localhost.evil.example", "127.0.0.1.nip.io", "", null]) expect(isAllowedHost(h)).toBe(false);
    expect(isAllowedHost("finance.local:3000", "finance.local")).toBe(true);
  });
});

describe("data checks (reconciliation)", () => {
  it("passes every check on the internally consistent demo company", async () => {
    const { reconcileDataset } = await import("@/lib/finance/reconcile");
    const { buildDemoDataset } = await import("@/lib/demo/generate");
    const checks = reconcileDataset(buildDemoDataset("2026-11-18", { generatedAt: "t" }));
    const byId = Object.fromEntries(checks.map((c) => [c.id, c.status]));
    expect(byId).toMatchObject({ "bs-balances": "match", "ar-vs-bs": "match", "ap-vs-bs": "match", "cash-vs-accounts": "match", "cf-vs-bs": "match", "ni-ytd": "match" });
  });

  it("reconciles a QuickBooks dataset against the report totals and flags differences", async () => {
    const { reconcileDataset } = await import("@/lib/finance/reconcile");
    const ok = <T,>(value: T) => ({ ok: true as const, value });
    const ds = assembleQboDataset(
      { asOfDate: AS_OF, companyInfo: fx.companyInfo, accounts: ok(fx.accounts), customers: ok(fx.customers), vendors: ok([]), invoices: ok(fx.invoices), bills: ok(fx.bills), payments: ok(fx.payments), pnl: ok(fx.pnlReport), balanceSheet: ok(fx.balanceSheetReport), cashFlow: ok(fx.cashFlowReport), aging: ok(fx.agedReceivablesReport) },
      "9130",
      "t",
    );
    const c = Object.fromEntries(reconcileDataset(ds).map((x) => [x.id, x]));
    expect(c["bs-balances"].status).toBe("match");
    expect(c["pnl-vs-source"].status).toBe("match");
    expect(c["pnl-vs-source"].label).toContain("3 of 3 months match");
    expect(c["bs-vs-source"].status).toBe("match");
    expect(c["cash-vs-accounts"].status).toBe("match");
    expect(c["ap-vs-bs"].status).toBe("match");
    expect(c["cf-vs-bs"].status).toBe("match");
    // Fixture invoices do not include every sandbox invoice, so A/R differs from the report: flagged, not hidden.
    expect(c["ar-vs-bs"].status).toBe("mismatch");
    expect(c["ar-vs-aging"].difference).toBeCloseTo(1001.07 - 933, 2);
  });
});

describe("report structure diagnostics", () => {
  it("describes report shape without any amounts", async () => {
    const { describeReport } = await import("@/lib/qbo/structure");
    const d = describeReport("pnl", fx.pnlReport);
    expect(d.columns.map((c) => c.title)).toEqual(["", "Sep 2026", "Oct 2026", "Nov 1-18, 2026", "Total"]);
    expect(d.rows.find((r) => r.label === "Landscaping Services")).toMatchObject({ depth: 1, type: "Section", childCount: 2 });
    expect(d.rows.some((r) => r.group === "NetIncome")).toBe(true);
    const text = JSON.stringify(d);
    for (const amount of ["6000", "3915", "1500.00", "2200"]) expect(text).not.toContain(amount);
  });
});
