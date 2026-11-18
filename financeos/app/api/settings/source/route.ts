import { NextResponse } from "next/server";
import { z } from "zod";
import { audit } from "@/lib/server/audit";
import { getRequestContext, requirePermission } from "@/lib/server/context";
import { getSettings, updateSettings } from "@/lib/server/settings";
import { isSameOrigin, jsonError, readJsonBody } from "@/lib/server/http";

const Body = z.object({ source: z.enum(["demo", "quickbooks-sandbox"]) });

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return jsonError(403, "Cross-origin request rejected.");
  const ctx = getRequestContext();
  requirePermission(ctx, "view:financials");
  const parsed = Body.safeParse(await readJsonBody(request));
  if (!parsed.success) return jsonError(400, "Invalid data source.");
  const before = await getSettings();
  const after = await updateSettings({ activeSource: parsed.data.source });
  if (before.activeSource !== after.activeSource) await audit("settings.source.changed", { from: before.activeSource, to: after.activeSource });
  return NextResponse.json({ ok: true, source: after.activeSource });
}
