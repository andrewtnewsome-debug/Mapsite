import { z } from "zod";
import { generateInsights } from "@/lib/finance/insights";
import { streamNarrative } from "@/lib/ai/narrative";
import { resolveOllamaConfig } from "@/lib/server/ai-config";
import { getRequestContext, requirePermission } from "@/lib/server/context";
import { isSameOrigin, jsonError, readJsonBody } from "@/lib/server/http";
import { ndjsonResponse } from "@/lib/server/ndjson";
import { activeDataset } from "@/lib/server/workspace";

const Body = z.object({ kind: z.enum(["management-summary", "insight"]), insightId: z.string().max(120).optional() });

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return jsonError(403, "Cross-origin request rejected.");
  requirePermission(getRequestContext(), "use:ai");
  const parsed = Body.safeParse(await readJsonBody(request));
  if (!parsed.success) return jsonError(400, "Invalid request.");
  const { dataset } = await activeDataset();
  if (!dataset) return jsonError(409, "No financial data is loaded.");
  const { config, error } = await resolveOllamaConfig();
  if (!config) return jsonError(400, error ?? "Ollama is not configured.");
  let insight = null;
  if (parsed.data.kind === "insight") {
    insight = generateInsights(dataset).find((i) => i.id === parsed.data.insightId) ?? null;
    if (!insight) return jsonError(404, "That insight is no longer triggered.");
  }
  return ndjsonResponse(streamNarrative(dataset, config, parsed.data.kind, insight), () => ({ type: "error", code: "error", message: "Commentary failed." }));
}
