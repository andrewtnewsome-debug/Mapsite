import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * OAuth state for CSRF protection.
 * The cookie value is "<state>.<expiresAtMs>.<hmac>" so it can only be issued
 * by this server, expires after 10 minutes, and is cleared after one use.
 */

export const STATE_COOKIE = "financeos_qbo_oauth_state";
export const STATE_TTL_MS = 10 * 60 * 1000;

function sign(secret: Buffer, payload: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function createOAuthState(secret: Buffer, now = Date.now()): { state: string; cookieValue: string } {
  const state = randomBytes(32).toString("base64url");
  const expires = now + STATE_TTL_MS;
  const payload = `${state}.${expires}`;
  return { state, cookieValue: `${payload}.${sign(secret, payload)}` };
}

export type StateCheck = { ok: true } | { ok: false; reason: "missing" | "malformed" | "bad-signature" | "expired" | "mismatch" };

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function validateOAuthState(secret: Buffer, returnedState: string | null, cookieValue: string | null | undefined, now = Date.now()): StateCheck {
  if (!returnedState || !cookieValue) return { ok: false, reason: "missing" };
  const parts = cookieValue.split(".");
  if (parts.length !== 3 || !/^\d+$/.test(parts[1])) return { ok: false, reason: "malformed" };
  const [state, expires, sig] = parts;
  if (!safeEqual(sig, sign(secret, `${state}.${expires}`))) return { ok: false, reason: "bad-signature" };
  if (now > Number(expires)) return { ok: false, reason: "expired" };
  if (!safeEqual(state, returnedState)) return { ok: false, reason: "mismatch" };
  return { ok: true };
}

/**
 * Server-side single-use tracking: a state value is accepted at most once,
 * even if a copy of the cookie is replayed.
 */
const consumed = new Map<string, number>();

export function consumeOAuthState(state: string, now = Date.now()): boolean {
  for (const [s, exp] of consumed) if (exp < now) consumed.delete(s);
  if (consumed.has(state)) return false;
  consumed.set(state, now + STATE_TTL_MS);
  return true;
}
