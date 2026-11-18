import { z } from "zod";
import { answerQuestion } from "@/lib/ai/answer";
import { TOOL_IDS, ToolParamsSchema } from "@/lib/ai/tools";
import { resolveOllamaConfig } from "@/lib/server/ai-config";
import { getRequestContext, requirePermission } from "@/lib/server/context";
import { isSameOrigin, jsonError, readJsonBody } from "@/lib/server/http";
import { ndjsonResponse } from "@/lib/server/ndjson";
import { activeDataset } from "@/lib/server/workspace";

const Body = z.object({
  question: z.string().trim().min(1).max(1000),
  history: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(6000) })).max(20).default([]),
  previousCalls: z.array(z.object({ id: z.enum(TOOL_IDS), params: ToolParamsSchema.default({}) })).max(5).default([]),
});

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return jsonError(403, "Cross-origin request rejected.");
  requirePermission(getRequestContext(), "use:ai");
  const parsed = Body.safeParse(await readJsonBody(request));
  if (!parsed.success) return jsonError(400, "Please enter a question (up to 1,000 characters).");
  const { dataset } = await activeDataset();
  if (!dataset) return jsonError(409, "No financial data is loaded for the selected data source. Connect QuickBooks Sandbox in Settings or switch to the Demo Company.");
  const { config, error } = await resolveOllamaConfig();
  const events = answerQuestion({
    question: parsed.data.question,
    history: parsed.data.history,
    previousCalls: parsed.data.previousCalls,
    dataset,
    ollama: config,
    ollamaConfigError: error,
    signal: request.signal,
  });
  return ndjsonResponse(events, () => ({ type: "error", message: "Something went wrong while answering. The financial data was not changed." }));
}
