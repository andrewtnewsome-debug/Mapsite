import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { readQboConfig } from "@/lib/qbo/config";
import { clearSyncState, loadSyncState, saveConnection } from "@/lib/qbo/connection-store";
import { deriveSecret } from "@/lib/qbo/crypto";
import { QboError } from "@/lib/qbo/errors";
import { exchangeAuthorizationCode } from "@/lib/qbo/oauth";
import { clearQboSnapshot } from "@/lib/qbo/snapshot";
import { consumeOAuthState, STATE_COOKIE, validateOAuthState } from "@/lib/qbo/state";
import { syncQuickBooks } from "@/lib/qbo/sync";
import { audit } from "@/lib/server/audit";
import { getRequestContext, requirePermission } from "@/lib/server/context";
import { updateSettings } from "@/lib/server/settings";

function done(url: URL, status: string) {
  const res = NextResponse.redirect(new URL(`/settings?qbo=${status}`, url));
  res.cookies.set(STATE_COOKIE, "", { httpOnly: true, sameSite: "lax", path: "/api/auth", maxAge: 0 });
  res.headers.set("Cache-Control", "no-store");
  return res;
}

export async function GET(request: Request) {
  requirePermission(getRequestContext(), "manage:integrations");
  const url = new URL(request.url);
  const params = url.searchParams;
  const cfg = readQboConfig();
  if (!cfg.ok) return done(url, "not-configured");

  const cookieStore = await cookies();
  const check = validateOAuthState(await deriveSecret("oauth-state"), params.get("state"), cookieStore.get(STATE_COOKIE)?.value);
  if (!check.ok) {
    await audit("integration.connect.failed", { reason: `state-${check.reason}` });
    return done(url, "state-invalid");
  }
  if (!consumeOAuthState(params.get("state")!)) {
    await audit("integration.connect.failed", { reason: "state-replayed" });
    return done(url, "state-invalid");
  }
  if (params.get("error")) {
    await audit("integration.connect.failed", { reason: params.get("error")!.slice(0, 40) });
    return done(url, "denied");
  }
  const code = params.get("code");
  const realmId = params.get("realmId");
  if (!code || code.length > 2000 || !realmId || !/^\d{1,30}$/.test(realmId)) {
    await audit("integration.connect.failed", { reason: "missing-code-or-realm" });
    return done(url, "invalid-callback");
  }

  try {
    const tokens = await exchangeAuthorizationCode(cfg.config, code);
    const previous = await loadSyncState();
    if (previous.realmId && previous.realmId !== realmId) {
      // A different sandbox company: never mix its data with the previous one.
      await clearQboSnapshot();
      await clearSyncState();
    }
    const now = new Date().toISOString();
    await saveConnection({ realmId, ...tokens, connectedAt: now, lastRefreshedAt: null, environment: "sandbox" });
    await updateSettings({ activeSource: "quickbooks-sandbox" });
    await audit("integration.connect.completed", { realmId, environment: "sandbox" });
  } catch (err) {
    await audit("integration.connect.failed", { reason: err instanceof QboError ? err.code : "token-exchange" });
    const status = err instanceof QboError && err.code === "auth-invalid" ? "bad-credentials" : err instanceof QboError && err.code === "network" ? "network" : "token-failed";
    return done(url, status);
  }

  const sync = await syncQuickBooks();
  return done(url, sync.ok ? "connected" : "connected-sync-failed");
}
