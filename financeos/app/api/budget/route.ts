import { NextResponse } from "next/server";
import { z } from "zod";
import { draftBudgetFromHistory, setAnnual } from "@/lib/finance/budget";
import { audit } from "@/lib/server/audit";
import { deleteBudget, loadBudget, saveBudget } from "@/lib/server/budget-store";
import { getRequestContext, requirePermission } from "@/lib/server/context";
import { forecastKey } from "@/lib/server/forecast-store";
import { isSameOrigin, jsonError, readJsonBody } from "@/lib/server/http";
import { activeDataset } from "@/lib/server/workspace";

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("draft"), growth: z.object({ income: z.number().min(-0.9).max(5), expense: z.number().min(-0.9).max(5) }) }),
  z.object({ action: z.literal("set-annual"), account: z.string().min(1).max(200), category: z.enum(["income", "cogs", "expense", "otherIncome", "otherExpense"]), annual: z.number().finite().min(-1e11).max(1e11) }),
]);

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return jsonError(403, "Cross-origin request rejected.");
  requirePermission(getRequestContext(), "edit:forecast");
  const { dataset } = await activeDataset();
  if (!dataset) return jsonError(409, "No data source is loaded.");
  const parsed = Body.safeParse(await readJsonBody(request));
  if (!parsed.success) return jsonError(400, "Invalid budget request.");
  const scope = forecastKey(dataset);
  if (parsed.data.action === "draft") {
    const b = draftBudgetFromHistory(dataset, parsed.data.growth);
    await saveBudget(scope, b);
    await audit("forecast.assumptions.saved", { kind: "budget-drafted", lines: b.lines.length });
    return NextResponse.json({ ok: true, budget: b });
  }
  const current = await loadBudget(scope);
  if (!current) return jsonError(404, "Create a budget first.");
  const updated = setAnnual(current, parsed.data.account, parsed.data.category, parsed.data.annual);
  await saveBudget(scope, updated);
  return NextResponse.json({ ok: true, budget: updated });
}

export async function DELETE(request: Request) {
  if (!isSameOrigin(request)) return jsonError(403, "Cross-origin request rejected.");
  requirePermission(getRequestContext(), "edit:forecast");
  const { dataset } = await activeDataset();
  if (!dataset) return jsonError(409, "No data source is loaded.");
  await deleteBudget(forecastKey(dataset));
  return NextResponse.json({ ok: true });
}
