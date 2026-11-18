import { NextResponse } from "next/server";
import { readQboConfig } from "@/lib/qbo/config";
import { clearConnection, clearSyncState, loadConnection } from "@/lib/qbo/connection-store";
import { revokeToken } from "@/lib/qbo/oauth";
import { clearQboSnapshot } from "@/lib/qbo/snapshot";
import { audit } from "@/lib/server/audit";
import { getRequestContext, requirePermission } from "@/lib/server/context";
import { isSameOrigin, jsonError } from "@/lib/server/http";
import { updateSettings } from "@/lib/server/settings";

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return jsonError(403, "Cross-origin request rejected.");
  requirePermission(getRequestContext(), "manage:integrations");
  const conn = await loadConnection();
  const cfg = readQboConfig();
  let revoked = false;
  if (conn && cfg.ok) revoked = await revokeToken(cfg.config, conn.refreshToken);
  await clearConnection();
  await clearQboSnapshot();
  await clearSyncState();
  await updateSettings({ activeSource: "demo" });
  await audit("integration.disconnected", { revokedAtIntuit: revoked });
  return NextResponse.json({ ok: true, revokedAtIntuit: revoked });
}
