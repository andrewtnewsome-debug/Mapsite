import { NextResponse } from "next/server";
import { z } from "zod";
import { audit } from "@/lib/server/audit";
import { getRequestContext, requirePermission } from "@/lib/server/context";
import { createFollowUp, deleteFollowUp, listFollowUps, NewFollowUpSchema, updateFollowUp, UpdateFollowUpSchema } from "@/lib/server/followups";
import { forecastKey } from "@/lib/server/forecast-store";
import { isSameOrigin, jsonError, readJsonBody } from "@/lib/server/http";
import { activeDataset } from "@/lib/server/workspace";

async function scope() {
  const { dataset } = await activeDataset();
  return dataset ? forecastKey(dataset) : null;
}

export async function GET() {
  requirePermission(getRequestContext(), "manage:collections");
  const s = await scope();
  if (!s) return jsonError(409, "No data source is loaded.");
  return NextResponse.json({ ok: true, followUps: await listFollowUps(s) });
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return jsonError(403, "Cross-origin request rejected.");
  requirePermission(getRequestContext(), "manage:collections");
  const s = await scope();
  if (!s) return jsonError(409, "No data source is loaded.");
  const parsed = NewFollowUpSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) return jsonError(400, "Invalid follow-up.");
  const f = await createFollowUp(s, parsed.data);
  await audit("collections.followup.created", { customerId: f.customerId });
  return NextResponse.json({ ok: true, followUp: f });
}

export async function PATCH(request: Request) {
  if (!isSameOrigin(request)) return jsonError(403, "Cross-origin request rejected.");
  requirePermission(getRequestContext(), "manage:collections");
  const s = await scope();
  if (!s) return jsonError(409, "No data source is loaded.");
  const parsed = UpdateFollowUpSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) return jsonError(400, "Invalid update.");
  const f = await updateFollowUp(s, parsed.data);
  if (!f) return jsonError(404, "Follow-up not found.");
  await audit("collections.followup.updated", { status: f.status });
  return NextResponse.json({ ok: true, followUp: f });
}

export async function DELETE(request: Request) {
  if (!isSameOrigin(request)) return jsonError(403, "Cross-origin request rejected.");
  requirePermission(getRequestContext(), "manage:collections");
  const s = await scope();
  if (!s) return jsonError(409, "No data source is loaded.");
  const parsed = z.object({ id: z.string().uuid() }).safeParse(await readJsonBody(request));
  if (!parsed.success) return jsonError(400, "Invalid request.");
  if (!(await deleteFollowUp(s, parsed.data.id))) return jsonError(404, "Follow-up not found.");
  await audit("collections.followup.deleted");
  return NextResponse.json({ ok: true });
}
