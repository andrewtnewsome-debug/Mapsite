import { NextResponse } from "next/server";
import { syncQuickBooks } from "@/lib/qbo/sync";
import { getRequestContext, requirePermission } from "@/lib/server/context";
import { isSameOrigin, jsonError } from "@/lib/server/http";

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return jsonError(403, "Cross-origin request rejected.");
  requirePermission(getRequestContext(), "sync:data");
  const result = await syncQuickBooks();
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: result.error?.code === "not-connected" || result.error?.code === "not-configured" ? 409 : 502 });
  return NextResponse.json({ ok: true, syncedAt: result.dataset?.syncedAt, warnings: result.dataset?.warnings.length ?? 0, requestCount: result.requestCount });
}
