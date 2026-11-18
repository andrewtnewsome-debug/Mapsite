import { NextResponse } from "next/server";
import { z } from "zod";
import { InvoiceDraftSchema } from "@/lib/finance/invoice-draft";
import { audit } from "@/lib/server/audit";
import { getRequestContext, requirePermission } from "@/lib/server/context";
import { forecastKey } from "@/lib/server/forecast-store";
import { isSameOrigin, jsonError, readJsonBody } from "@/lib/server/http";
import { deleteDraft, listDrafts, saveDraft } from "@/lib/server/invoice-drafts";
import { activeDataset } from "@/lib/server/workspace";

async function scope() {
  const { dataset } = await activeDataset();
  return dataset ? forecastKey(dataset) : null;
}

export async function GET() {
  requirePermission(getRequestContext(), "draft:invoices");
  const s = await scope();
  if (!s) return jsonError(409, "No data source is loaded.");
  return NextResponse.json({ ok: true, drafts: await listDrafts(s) });
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return jsonError(403, "Cross-origin request rejected.");
  requirePermission(getRequestContext(), "draft:invoices");
  const s = await scope();
  if (!s) return jsonError(409, "No data source is loaded.");
  const parsed = z.object({ id: z.string().uuid().optional(), draft: InvoiceDraftSchema }).safeParse(await readJsonBody(request));
  if (!parsed.success) return jsonError(400, "The draft needs a customer name, valid dates and at least one line item.");
  const saved = await saveDraft(s, parsed.data.draft, parsed.data.id);
  await audit("invoice.draft.saved", { lines: saved.draft.lines.length });
  return NextResponse.json({ ok: true, saved });
}

export async function DELETE(request: Request) {
  if (!isSameOrigin(request)) return jsonError(403, "Cross-origin request rejected.");
  requirePermission(getRequestContext(), "draft:invoices");
  const s = await scope();
  if (!s) return jsonError(409, "No data source is loaded.");
  const parsed = z.object({ id: z.string().uuid() }).safeParse(await readJsonBody(request));
  if (!parsed.success) return jsonError(400, "Invalid request.");
  if (!(await deleteDraft(s, parsed.data.id))) return jsonError(404, "Draft not found.");
  await audit("invoice.draft.deleted");
  return NextResponse.json({ ok: true });
}
