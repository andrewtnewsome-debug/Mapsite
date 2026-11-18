import { NextResponse } from "next/server";
import { readQboConfig } from "@/lib/qbo/config";
import { deriveSecret } from "@/lib/qbo/crypto";
import { buildAuthorizeUrl } from "@/lib/qbo/oauth";
import { createOAuthState, STATE_COOKIE, STATE_TTL_MS } from "@/lib/qbo/state";
import { audit } from "@/lib/server/audit";
import { getRequestContext, requirePermission } from "@/lib/server/context";

export async function GET(request: Request) {
  requirePermission(getRequestContext(), "manage:integrations");
  const url = new URL(request.url);
  const cfg = readQboConfig();
  if (!cfg.ok) return NextResponse.redirect(new URL("/settings?qbo=not-configured", url));
  // The state cookie must be set on the same host Intuit redirects back to (e.g. localhost vs 127.0.0.1).
  const redirectOrigin = new URL(cfg.config.redirectUri).origin;
  const host = request.headers.get("host");
  if (host && `${url.protocol}//${host}` !== redirectOrigin) {
    return NextResponse.redirect(`${redirectOrigin}/api/auth/connect`);
  }
  const { state, cookieValue } = createOAuthState(await deriveSecret("oauth-state"));
  await audit("integration.connect.started", { environment: "sandbox" });
  const res = NextResponse.redirect(buildAuthorizeUrl(cfg.config, state));
  res.cookies.set(STATE_COOKIE, cookieValue, { httpOnly: true, sameSite: "lax", secure: false, path: "/api/auth", maxAge: Math.floor(STATE_TTL_MS / 1000) });
  res.headers.set("Cache-Control", "no-store");
  return res;
}
