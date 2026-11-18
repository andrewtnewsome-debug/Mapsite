/**
 * QuickBooks Online configuration.
 *
 * OAuth uses Intuit's production authorization and token endpoints (Intuit
 * uses the same OAuth endpoints for development and production keys), while
 * every accounting API request goes exclusively to the sandbox host.
 */

export const INTUIT_AUTHORIZE_URL = "https://appcenter.intuit.com/connect/oauth2";
export const INTUIT_TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
export const INTUIT_REVOKE_URL = "https://developer.api.intuit.com/v2/oauth2/tokens/revoke";
/** The only accounting API host this version will call. */
export const QBO_SANDBOX_API_BASE = "https://sandbox-quickbooks.api.intuit.com/v3";
export const QBO_SCOPE = "com.intuit.quickbooks.accounting";
/** Intuit requires minor version 75 or later for current API behavior. */
export const QBO_MINOR_VERSION = "75";

export interface QboConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  environment: "sandbox";
}

export type QboConfigResult = { ok: true; config: QboConfig } | { ok: false; problems: string[] };

export function readQboConfig(env: Record<string, string | undefined> = process.env): QboConfigResult {
  const problems: string[] = [];
  const clientId = env.INTUIT_CLIENT_ID?.trim() ?? "";
  const clientSecret = env.INTUIT_CLIENT_SECRET?.trim() ?? "";
  const redirectUri = env.INTUIT_REDIRECT_URI?.trim() || "http://localhost:3000/api/auth/callback";
  const environment = (env.INTUIT_ENVIRONMENT?.trim() || "sandbox").toLowerCase();

  if (!clientId) problems.push("INTUIT_CLIENT_ID is not set in .env.local.");
  if (!clientSecret) problems.push("INTUIT_CLIENT_SECRET is not set in .env.local.");
  if (environment !== "sandbox") problems.push(`INTUIT_ENVIRONMENT must be "sandbox" in this version (found "${environment}"). Production access is disabled.`);
  try {
    const u = new URL(redirectUri);
    const localHost = u.hostname === "localhost" || u.hostname === "127.0.0.1";
    if (u.protocol !== "http:" || !localHost) problems.push("INTUIT_REDIRECT_URI must be a local http://localhost address for this prototype.");
    if (u.pathname !== "/api/auth/callback") problems.push("INTUIT_REDIRECT_URI must end with /api/auth/callback.");
  } catch {
    problems.push("INTUIT_REDIRECT_URI is not a valid URL.");
  }
  if (problems.length > 0) return { ok: false, problems };
  return { ok: true, config: { clientId, clientSecret, redirectUri, environment: "sandbox" } };
}

/** Guard used by the API client: refuses any URL that is not on the sandbox host. */
export function assertSandboxUrl(url: string): void {
  const u = new URL(url);
  const sandbox = new URL(QBO_SANDBOX_API_BASE);
  if (u.protocol !== "https:" || u.host !== sandbox.host || !u.pathname.startsWith("/v3/")) {
    throw new Error("Refusing to call a non-sandbox QuickBooks host");
  }
}
