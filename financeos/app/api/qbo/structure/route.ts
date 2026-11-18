import { NextResponse } from "next/server";
import { getRequestContext, requirePermission } from "@/lib/server/context";
import { jsonError } from "@/lib/server/http";
import { readJson } from "@/lib/server/store";

/** Downloads the amount-free report structure from the last QuickBooks sync. */
export async function GET() {
  requirePermission(getRequestContext(), "manage:integrations");
  const data = await readJson<unknown>("qbo-report-structure.json", (raw) => raw, null);
  if (!data) return jsonError(404, "No QuickBooks sync has been recorded yet.");
  return new NextResponse(JSON.stringify(data, null, 2), {
    headers: { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": 'attachment; filename="financeos-qbo-report-structure.json"', "Cache-Control": "no-store" },
  });
}
