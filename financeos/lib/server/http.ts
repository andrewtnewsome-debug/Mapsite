import "server-only";

import { NextResponse } from "next/server";

const MAX_BODY_BYTES = 256 * 1024;

/** Reads a JSON body with a size cap. Returns undefined for invalid JSON. */
export async function readJsonBody(request: Request): Promise<unknown> {
  const len = Number(request.headers.get("content-length") ?? "0");
  if (len > MAX_BODY_BYTES) return undefined;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) return undefined;
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export function jsonError(status: number, message: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ ok: false, error: message, ...extra }, { status });
}

/**
 * Rejects cross-site state-changing requests. Browsers send Origin on POST;
 * it must match the host the app is served from.
 */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true; // non-browser clients (tests, curl) - app is bound to localhost
  try {
    const o = new URL(origin);
    const host = request.headers.get("host");
    return host != null && o.host === host;
  } catch {
    return false;
  }
}
