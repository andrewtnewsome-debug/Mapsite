import { z } from "zod";
import { INTUIT_AUTHORIZE_URL, INTUIT_REVOKE_URL, INTUIT_TOKEN_URL, QBO_SCOPE, type QboConfig } from "./config";
import { QboError } from "./errors";

const TokenResponseSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  token_type: z.string().optional(),
  expires_in: z.coerce.number().positive(),
  x_refresh_token_expires_in: z.coerce.number().positive().optional(),
});

export interface TokenSet {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: string;
  refreshTokenExpiresAt: string | null;
}

export function buildAuthorizeUrl(cfg: QboConfig, state: string): string {
  const u = new URL(INTUIT_AUTHORIZE_URL);
  u.searchParams.set("client_id", cfg.clientId);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", QBO_SCOPE);
  u.searchParams.set("redirect_uri", cfg.redirectUri);
  u.searchParams.set("state", state);
  return u.toString();
}

function basicAuth(cfg: QboConfig): string {
  return `Basic ${Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString("base64")}`;
}

async function tokenRequest(cfg: QboConfig, params: Record<string, string>, fetchImpl: typeof fetch, now: number): Promise<TokenSet> {
  let res: Response;
  try {
    res = await fetchImpl(INTUIT_TOKEN_URL, {
      method: "POST",
      headers: { Authorization: basicAuth(cfg), Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(params).toString(),
      signal: AbortSignal.timeout(20_000),
      cache: "no-store",
    });
  } catch {
    throw new QboError("network");
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // fall through
  }
  if (!res.ok) {
    const err = (body as { error?: string; error_description?: string })?.error ?? "";
    if (err === "invalid_grant") throw new QboError(params.grant_type === "refresh_token" ? "auth-expired" : "auth-revoked", "", res.status);
    if (err === "invalid_client" || res.status === 401) throw new QboError("auth-invalid", "", res.status);
    throw new QboError("api-error", `Token request failed (HTTP ${res.status}${err ? `, ${err}` : ""}).`, res.status);
  }
  const parsed = TokenResponseSchema.safeParse(body);
  if (!parsed.success) throw new QboError("bad-response", "Token response was missing required fields.");
  const t = parsed.data;
  return {
    accessToken: t.access_token,
    refreshToken: t.refresh_token,
    accessTokenExpiresAt: new Date(now + t.expires_in * 1000).toISOString(),
    refreshTokenExpiresAt: t.x_refresh_token_expires_in ? new Date(now + t.x_refresh_token_expires_in * 1000).toISOString() : null,
  };
}

export function exchangeAuthorizationCode(cfg: QboConfig, code: string, fetchImpl: typeof fetch = fetch, now = Date.now()): Promise<TokenSet> {
  return tokenRequest(cfg, { grant_type: "authorization_code", code, redirect_uri: cfg.redirectUri }, fetchImpl, now);
}

export function refreshAccessToken(cfg: QboConfig, refreshToken: string, fetchImpl: typeof fetch = fetch, now = Date.now()): Promise<TokenSet> {
  return tokenRequest(cfg, { grant_type: "refresh_token", refresh_token: refreshToken }, fetchImpl, now);
}

/** Best-effort token revocation. Never throws. */
export async function revokeToken(cfg: QboConfig, token: string, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  try {
    const res = await fetchImpl(INTUIT_REVOKE_URL, {
      method: "POST",
      headers: { Authorization: basicAuth(cfg), Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
      signal: AbortSignal.timeout(15_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** True when the access token expires within the margin. */
export function needsRefresh(accessTokenExpiresAt: string, now = Date.now(), marginMs = 5 * 60 * 1000): boolean {
  const t = Date.parse(accessTokenExpiresAt);
  return !Number.isFinite(t) || t - now <= marginMs;
}
