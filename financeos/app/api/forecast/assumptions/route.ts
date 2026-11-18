import { NextResponse } from "next/server";
import { ForecastAssumptionsSchema } from "@/lib/finance/forecast-schema";
import { audit } from "@/lib/server/audit";
import { getRequestContext, requirePermission } from "@/lib/server/context";
import { deleteSavedAssumptions, forecastKey, saveAssumptions } from "@/lib/server/forecast-store";
import { isSameOrigin, jsonError, readJsonBody } from "@/lib/server/http";
import { activeDataset } from "@/lib/server/workspace";

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return jsonError(403, "Cross-origin request rejected.");
  requirePermission(getRequestContext(), "edit:forecast");
  const { dataset } = await activeDataset();
  if (!dataset) return jsonError(409, "No data is available for the selected data source.");
  const parsed = ForecastAssumptionsSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) return jsonError(400, "Invalid assumptions.", { issues: parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`) });
  const savedAt = await saveAssumptions(forecastKey(dataset), parsed.data);
  await audit("forecast.assumptions.saved", { source: dataset.source });
  return NextResponse.json({ ok: true, savedAt });
}

export async function DELETE(request: Request) {
  if (!isSameOrigin(request)) return jsonError(403, "Cross-origin request rejected.");
  requirePermission(getRequestContext(), "edit:forecast");
  const { dataset } = await activeDataset();
  if (!dataset) return jsonError(409, "No data is available for the selected data source.");
  await deleteSavedAssumptions(forecastKey(dataset));
  return NextResponse.json({ ok: true });
}
