/**
 * AI CFO pipeline:
 *   1. interpret the question (deterministic router, optionally the local model for tool selection)
 *   2. run deterministic financial tools
 *   3. send only verified results to the local model to write the answer
 *   4. verify every figure in the answer against the verified results
 * Falls back to deterministic answers when Ollama is unavailable.
 */

import { z } from "zod";
import type { FinancialDataset } from "@/lib/domain/types";
import { followUpsFor } from "./followups";
import { verifyAnswer, type Verification } from "./guard";
import { chatJson, chatStream, getOllamaStatus, OllamaError, type OllamaConfig, type OllamaStatus } from "./ollama";
import { buildMessages, type HistoryTurn } from "./prompt";
import { routeFollowUp, routeQuestion, SUPPORTED_QUESTIONS } from "./router";
import { runTool, TOOL_DESCRIPTIONS, TOOL_IDS, ToolParamsSchema, type ToolCall, type ToolResult } from "./tools";

export type AnswerMode = "ai" | "deterministic";

export type ChatEvent =
  | { type: "meta"; mode: AnswerMode; model: string | null; calls: ToolCall[]; results: ToolResult[]; routing: "rules" | "follow-up" | "model" | "none"; notice: string | null }
  | { type: "token"; text: string }
  | { type: "done"; answer: string; verification: Verification | null; followUps: string[]; mode: AnswerMode }
  | { type: "error"; message: string };

export interface AnswerInput {
  question: string;
  history: HistoryTurn[];
  previousCalls: ToolCall[];
  dataset: FinancialDataset;
  ollama: OllamaConfig | null;
  /** Config error to show (e.g. non-local OLLAMA_BASE_URL). */
  ollamaConfigError?: string | null;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}

const ToolSelectionSchema = z.object({
  tools: z.array(z.object({ id: z.enum(TOOL_IDS), params: ToolParamsSchema.default({}) })).max(3),
});

const SELECTION_JSON_SCHEMA = {
  type: "object",
  properties: {
    tools: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string", enum: [...TOOL_IDS] },
          params: {
            type: "object",
            properties: { limit: { type: "integer" }, days: { type: "integer" }, weeks: { type: "integer" }, customer: { type: "string" }, period: { type: "string" }, overdueOnly: { type: "boolean" } },
          },
        },
        required: ["id"],
      },
    },
  },
  required: ["tools"],
};

/** Ask the local model which financial tools a question needs. Output is validated against a whitelist. */
export async function selectToolsWithModel(question: string, cfg: OllamaConfig, fetchImpl?: typeof fetch): Promise<ToolCall[]> {
  const catalog = TOOL_IDS.map((id) => `- ${id}: ${TOOL_DESCRIPTIONS[id]}`).join("\n");
  const raw = await chatJson<unknown>(
    cfg,
    [
      { role: "system", content: `You route finance questions to data tools. Pick at most 3 tools from this list that are needed to answer. If none apply, return an empty list.\n${catalog}\nRespond with JSON only.` },
      { role: "user", content: question },
    ],
    SELECTION_JSON_SCHEMA,
    {},
    fetchImpl,
  );
  const parsed = ToolSelectionSchema.safeParse(raw);
  if (!parsed.success) return [];
  return parsed.data.tools.map((t) => ({ id: t.id, params: t.params }));
}

function deterministicAnswer(results: ToolResult[]): string {
  return results.map((r) => r.summary).join("\n\n");
}

const UNSUPPORTED = `I can answer questions about this company's cash, receivables, collections, profitability, expenses, payables, ratios, cash forecast and risks. Try one of these:\n${SUPPORTED_QUESTIONS.slice(0, 6)
  .map((q) => `- ${q}`)
  .join("\n")}`;

export async function* answerQuestion(input: AnswerInput): AsyncGenerator<ChatEvent> {
  const { question, dataset, ollama } = input;
  const status: OllamaStatus | null = ollama ? await getOllamaStatus(ollama, input.fetchImpl) : null;
  const aiReady = Boolean(status?.running && status.modelInstalled);
  const notice = input.ollamaConfigError
    ? input.ollamaConfigError
    : !status?.running
      ? "Ollama is not running, so this answer was assembled directly from FinanceOS calculations. Full AI chat requires Ollama (see Settings)."
      : !status.modelInstalled
        ? `The model "${status.model}" is not installed in Ollama. Run "ollama pull ${status.model}". This answer was assembled directly from FinanceOS calculations.`
        : null;

  // 1. Interpret the question.
  let routing: "rules" | "follow-up" | "model" | "none" = "rules";
  let calls = routeQuestion(question, dataset).calls;
  if (calls.length === 0) {
    const fu = routeFollowUp(question, input.previousCalls, dataset);
    if (fu) {
      calls = fu;
      routing = "follow-up";
    }
  }
  if (calls.length === 0 && aiReady && ollama) {
    try {
      calls = await selectToolsWithModel(question, ollama, input.fetchImpl);
      routing = calls.length ? "model" : "none";
    } catch {
      routing = "none";
    }
  } else if (calls.length === 0) {
    routing = "none";
  }

  // 2. Run deterministic tools.
  const results = calls.map((c) => runTool(dataset, c));
  const mode: AnswerMode = aiReady ? "ai" : "deterministic";
  yield { type: "meta", mode, model: aiReady ? status!.model : null, calls, results, routing, notice };

  const followUps = followUpsFor(
    calls.map((c) => c.id),
    question,
  );

  if (!aiReady || !ollama) {
    const answer = results.length ? deterministicAnswer(results) : UNSUPPORTED;
    yield { type: "done", answer, verification: null, followUps: results.length ? followUps : SUPPORTED_QUESTIONS.slice(0, 3), mode: "deterministic" };
    return;
  }

  // 3. Let the local model explain the verified results.
  let answer = "";
  try {
    for await (const chunk of chatStream(ollama, buildMessages(dataset, question, results, input.history), { signal: input.signal }, input.fetchImpl)) {
      answer += chunk;
      yield { type: "token", text: chunk };
    }
  } catch (err) {
    if ((err as Error).name === "AbortError") return;
    const message = err instanceof OllamaError ? err.message : "The local model failed while answering.";
    yield { type: "error", message };
    const fallback = results.length ? deterministicAnswer(results) : UNSUPPORTED;
    yield { type: "done", answer: fallback, verification: null, followUps, mode: "deterministic" };
    return;
  }
  answer = answer.trim();
  if (!answer) {
    yield { type: "done", answer: results.length ? deterministicAnswer(results) : UNSUPPORTED, verification: null, followUps, mode: "deterministic" };
    return;
  }

  // 4. Verify the figures the model used.
  const verification = verifyAnswer(answer, results, [question]);
  yield { type: "done", answer, verification, followUps, mode: "ai" };
}
