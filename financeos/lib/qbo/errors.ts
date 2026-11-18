export type QboErrorCode =
  | "not-configured"
  | "not-connected"
  | "auth-expired"
  | "auth-revoked"
  | "auth-invalid"
  | "forbidden"
  | "rate-limited"
  | "api-error"
  | "network"
  | "bad-response";

/** User-facing messages for each failure. Never includes tokens or secrets. */
export const QBO_ERROR_MESSAGES: Record<QboErrorCode, string> = {
  "not-configured": "QuickBooks keys are not configured. Add INTUIT_CLIENT_ID and INTUIT_CLIENT_SECRET to .env.local and restart FinanceOS.",
  "not-connected": "QuickBooks Sandbox is not connected. Use Connect QuickBooks Sandbox in Settings.",
  "auth-expired": "The QuickBooks authorization has expired. Disconnect and connect again to re-authorize.",
  "auth-revoked": "QuickBooks access was revoked or is no longer valid. Disconnect and connect again.",
  "auth-invalid": "QuickBooks rejected the app credentials. Check INTUIT_CLIENT_ID, INTUIT_CLIENT_SECRET and the redirect URI in your Intuit developer app.",
  forbidden: "QuickBooks denied access to this data. The connected user may lack permission.",
  "rate-limited": "QuickBooks is rate-limiting requests. Wait a minute and sync again.",
  "api-error": "QuickBooks returned an error.",
  network: "Could not reach QuickBooks. Check your internet connection and try again.",
  "bad-response": "QuickBooks returned data in an unexpected format.",
};

export class QboError extends Error {
  constructor(
    public readonly code: QboErrorCode,
    detail?: string,
    public readonly status?: number,
  ) {
    super(detail ? `${QBO_ERROR_MESSAGES[code]} ${detail}` : QBO_ERROR_MESSAGES[code]);
    this.name = "QboError";
  }
}

/** Extract a readable message from an Intuit "Fault" response body. */
export function faultMessage(body: unknown): string | null {
  const fault = (body as { Fault?: { Error?: { Message?: string; Detail?: string; code?: string }[]; type?: string } })?.Fault;
  const e = fault?.Error?.[0];
  if (!e) return null;
  return [e.Message, e.Detail, e.code ? `(code ${e.code})` : null].filter(Boolean).join(" - ").slice(0, 400);
}
