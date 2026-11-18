import { NextResponse } from "next/server";
import { z } from "zod";
import { audit } from "@/lib/server/audit";
import { getRequestContext, requirePermission } from "@/lib/server/context";
import { isSameOrigin, jsonError, readJsonBody } from "@/lib/server/http";
import { updateSettings } from "@/lib/server/settings";

const Body = z.object({ model: z.string().trim().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,99}$/).nullable() });

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return jsonError(403, "Cross-origin request rejected.");
  requirePermission(getRequestContext(), "use:ai");
  const parsed = Body.safeParse(await readJsonBody(request));
  if (!parsed.success) return jsonError(400, "Enter a valid Ollama model name, e.g. qwen3:4b.");
  const s = await updateSettings({ ollamaModel: parsed.data.model });
  await audit("settings.model.changed", { model: s.ollamaModel ?? "default" });
  return NextResponse.json({ ok: true, model: s.ollamaModel });
}
