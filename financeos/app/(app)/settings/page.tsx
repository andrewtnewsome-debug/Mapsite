import { AiStatusCard } from "@/components/ai/ai-status-card";
import { DataChecksCard } from "@/components/finance/data-checks";
import { PageHeader } from "@/components/finance/page-header";
import { DataSourcePicker, ModelPicker, QboActions, ThemePicker } from "@/components/settings/settings-client";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Notice } from "@/components/ui/states";
import { Table, TableWrap, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { DEFAULT_OLLAMA_MODEL, getOllamaStatus, modelThinkingMode } from "@/lib/ai/ollama";
import { formatTimestamp } from "@/lib/format";
import { resolveOllamaConfig } from "@/lib/server/ai-config";
import { recentAuditEvents } from "@/lib/server/audit";
import { dataDir } from "@/lib/server/store";
import { loadWorkspace } from "@/lib/server/workspace";

export const metadata = { title: "Settings" };

const CALLBACK_MESSAGES: Record<string, { tone: "info" | "warning" | "critical"; text: string }> = {
  connected: { tone: "info", text: "QuickBooks Sandbox connected and synced. FinanceOS is now showing your sandbox company." },
  "connected-sync-failed": { tone: "warning", text: "QuickBooks Sandbox connected, but the first sync failed. See the error below and try Sync now." },
  denied: { tone: "warning", text: "Authorization was cancelled in QuickBooks. Nothing was connected." },
  "state-invalid": { tone: "critical", text: "The connection was rejected because the security check (OAuth state) failed or expired. Start again with Connect QuickBooks Sandbox, and open FinanceOS at http://localhost:3000." },
  "invalid-callback": { tone: "critical", text: "QuickBooks returned an incomplete response. Please try connecting again." },
  "token-failed": { tone: "critical", text: "QuickBooks did not issue access tokens. Check that the redirect URI in your Intuit app is exactly http://localhost:3000/api/auth/callback." },
  "bad-credentials": { tone: "critical", text: "Intuit rejected the app credentials. Check INTUIT_CLIENT_ID and INTUIT_CLIENT_SECRET (Development keys) in .env.local." },
  network: { tone: "critical", text: "FinanceOS could not reach Intuit to finish connecting. Check your internet connection (and any firewall or VPN) and try again." },
  "not-configured": { tone: "warning", text: "Add your Intuit development keys to .env.local and restart FinanceOS before connecting." },
};

export default async function SettingsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ws = await loadWorkspace();
  const q = ws.qbo;
  const sp = await searchParams;
  const callback = typeof sp.qbo === "string" ? CALLBACK_MESSAGES[sp.qbo] : undefined;
  const { config, error } = await resolveOllamaConfig();
  const ollama = config ? await getOllamaStatus(config) : null;
  const thinkingMode = config && ollama?.modelInstalled ? await modelThinkingMode(config) : null;
  const events = await recentAuditEvents(15);

  return (
    <>
      <PageHeader title="Settings" description="Data sources, integrations, local AI and preferences. Everything is stored on this computer." />
      {callback ? (
        <Notice tone={callback.tone} className="mb-4">
          {callback.text}
        </Notice>
      ) : null}

      <div className="space-y-4">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Data source</CardTitle>
              <CardDescription>Choose which company FinanceOS shows. Demo and sandbox data are stored separately and never mixed.</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <DataSourcePicker source={ws.source} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>QuickBooks Online Sandbox</CardTitle>
              <CardDescription>Read-only connection to an Intuit sandbox company via OAuth 2.0. Production companies are not supported in this version.</CardDescription>
            </div>
            <Badge tone={q.connected ? "good" : q.configured ? "neutral" : "warning"}>{q.connected ? "Connected" : q.configured ? "Not connected" : "Keys not configured"}</Badge>
          </CardHeader>
          <CardContent className="space-y-4">
            {!q.configured ? (
              <Notice tone="warning" title="Setup needed">
                <ul className="list-disc pl-5">
                  {q.configProblems.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
                <p className="mt-1">See SETUP_GUIDE.md, section &quot;Connect your QuickBooks sandbox&quot;, for step-by-step instructions.</p>
              </Notice>
            ) : null}
            <dl className="grid grid-cols-1 gap-x-8 gap-y-2 text-[13px] sm:grid-cols-2">
              {[
                ["Environment", "Sandbox (sandbox-quickbooks.api.intuit.com)"],
                ["Company", q.companyName ?? "Not synced"],
                ["Company ID (realm)", q.realmId ?? "Not connected"],
                ["Connected", formatTimestamp(q.connectedAt)],
                ["Last successful sync", formatTimestamp(q.lastSyncAt)],
                ["Last attempt", formatTimestamp(q.lastAttemptAt)],
                ["Access token expires", q.connected ? `${formatTimestamp(q.accessTokenExpiresAt)} (refreshed automatically)` : "Not available"],
                ["Authorization expires", formatTimestamp(q.refreshTokenExpiresAt)],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3 border-b border-border py-1.5">
                  <dt className="text-text-3">{k}</dt>
                  <dd className="text-right font-medium">{v}</dd>
                </div>
              ))}
            </dl>
            {Object.keys(q.counts).length ? (
              <p className="text-[12px] text-text-3">
                Last sync loaded: {Object.entries(q.counts).map(([k, v]) => `${v} ${k.replace(/([A-Z])/g, " $1").toLowerCase()}`).join(", ")}.
              </p>
            ) : null}
            {q.lastError ? <Notice tone="critical" title={`Last sync failed${q.lastErrorCode ? ` (${q.lastErrorCode})` : ""}`}>{q.lastError}</Notice> : null}
            {ws.source === "quickbooks-sandbox" && ws.dataset?.warnings.length ? (
              <Notice tone="warning" title="Data quality notes from the last sync">
                <ul className="list-disc pl-5">
                  {ws.dataset.warnings.slice(0, 8).map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              </Notice>
            ) : null}
            <QboActions configured={q.configured} connected={q.connected} />
            {q.lastSyncAt ? (
              <p className="text-[12px] text-text-3">
                Troubleshooting:{" "}
                <a className="font-medium text-accent hover:underline" href="/api/qbo/structure" download>
                  download the report structure
                </a>{" "}
                from the last sync. It lists report sections and row labels without any amounts.
              </p>
            ) : null}
            <p className="text-[12px] text-text-3">
              FinanceOS only reads data (accounts, customers, vendors, invoices, bills, payments and reports). It never creates, edits or deletes anything in QuickBooks. Tokens are encrypted on this computer and never sent to the browser.
            </p>
          </CardContent>
        </Card>

        {ws.dataset ? <DataChecksCard dataset={ws.dataset} /> : null}

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="lg:col-span-1">
            <AiStatusCard status={ollama} configError={error} thinkingMode={thinkingMode} />
          </div>
          <Card className="lg:col-span-2">
            <CardHeader>
              <div>
                <CardTitle>Local AI model</CardTitle>
                <CardDescription>Ollama runs the model on this computer. Financial data is never sent to an external AI service.</CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              <ModelPicker current={config?.model ?? DEFAULT_OLLAMA_MODEL} installed={ollama?.models.map((m) => m.name) ?? []} envDefault={process.env.OLLAMA_MODEL?.trim() || DEFAULT_OLLAMA_MODEL} />
              <p className="mt-3 text-[12px] text-text-3">Ollama address: {config?.baseUrl ?? "invalid"} (set OLLAMA_BASE_URL in .env.local; only local addresses are accepted).</p>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Appearance</CardTitle>
            </div>
            <ThemePicker />
          </CardHeader>
          <div className="pb-5" />
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Privacy and activity log</CardTitle>
              <CardDescription>Local data folder: {dataDir()}</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-3 px-0 pb-2">
            <ul className="list-disc space-y-1 px-10 text-[13px] text-text-2">
              <li>Network calls leave this computer only for QuickBooks Sandbox (Intuit OAuth and the sandbox API) when you connect or sync.</li>
              <li>AI requests go only to Ollama on this computer.</li>
              <li>This is a local prototype. It does not provide production-grade security or compliance.</li>
            </ul>
            {events.length ? (
              <TableWrap aria-label="Activity log">
                <Table>
                  <THead>
                    <TR className="hover:bg-transparent">
                      <TH>Time</TH>
                      <TH>Action</TH>
                      <TH>Details</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {events.map((e, i) => (
                      <TR key={`${e.at}-${i}`}>
                        <TD className="whitespace-nowrap text-text-2">{formatTimestamp(e.at)}</TD>
                        <TD className="whitespace-nowrap font-medium">{e.action}</TD>
                        <TD className="text-[12px] text-text-3">{e.detail ? Object.entries(e.detail).map(([k, v]) => `${k}: ${v}`).join(", ") : ""}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </TableWrap>
            ) : (
              <p className="px-5 text-[13px] text-text-3">No activity recorded yet.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
