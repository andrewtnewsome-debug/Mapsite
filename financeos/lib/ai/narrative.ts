/**
 * AI-written commentary on deterministic results (management summary, insights).
 * The model explains; FinanceOS supplies every figure and verifies the output.
 */

import type { FinancialDataset } from "@/lib/domain/types";
import { DATA_SOURCE_LABELS } from "@/lib/domain/types";
import type { Insight } from "@/lib/finance/insights";
import { verifyAnswer } from "./guard";
import { chatStream, getOllamaStatus, OllamaError, stripReasoning, type OllamaConfig } from "./ollama";
import { dataBlock, systemPrompt } from "./prompt";
import { runTool, type ToolContext, type ToolResult } from "./tools";

export type NarrativeEvent =
  | { type: "token"; text: string }
  | { type: "done"; text: string; unverified: string[]; model: string }
  | { type: "error"; message: string; code: string };

export function insightAsToolResult(ds: FinancialDataset, insight: Insight): ToolResult {
  return {
    toolId: "financial_risks",
    title: insight.title,
    asOfDate: ds.asOfDate,
    source: DATA_SOURCE_LABELS[ds.source],
    facts: [
      ...insight.facts.map((f) => ({ label: f.label, value: f.value, display: f.value, kind: "text" as const, basis: "fact" as const })),
      ...insight.forecasts.map((f, i) => ({ label: `Forecast ${i + 1}`, value: f, display: f, kind: "text" as const, basis: "forecast" as const })),
    ],
    assumptions: [...insight.assumptions, `Trigger rule: ${insight.trigger}`],
    notes: [],
    summary: insight.title,
    available: true,
  };
}

export async function* streamNarrative(
  ds: FinancialDataset,
  cfg: OllamaConfig,
  kind: "management-summary" | "insight",
  insight: Insight | null,
  fetchImpl?: typeof fetch,
  ctx: ToolContext = {},
): AsyncGenerator<NarrativeEvent> {
  const status = await getOllamaStatus(cfg, fetchImpl);
  if (!status.running) {
    yield { type: "error", code: "unavailable", message: "Ollama is not running. Start Ollama to generate AI commentary; all figures above are still available." };
    return;
  }
  if (!status.modelInstalled) {
    yield { type: "error", code: "model-missing", message: `The model "${cfg.model}" is not installed. Run: ollama pull ${cfg.model}` };
    return;
  }
  const results =
    kind === "insight" && insight
      ? [insightAsToolResult(ds, insight)]
      : [runTool(ds, { id: "profit_and_loss", params: { period: "last-month" } }), runTool(ds, { id: "cash_position", params: {} }), runTool(ds, { id: "receivables_summary", params: {} }), runTool(ds, { id: "payables_summary", params: {} }), runTool(ds, { id: "financial_risks", params: {} }, ctx)];
  const instruction =
    kind === "insight"
      ? "Explain this observation to the owner in 2-4 sentences: what it means for the business and what to look into. Do not state causes as facts; the data does not show why it happened."
      : "Write a short management commentary for the owner: one brief paragraph each on profitability, cash, receivables and payables, and key risks. Use only the verified figures.";
  let text = "";
  try {
    for await (const chunk of chatStream(cfg, [
      { role: "system", content: systemPrompt(ds) },
      { role: "user", content: `${instruction}\n\nVERIFIED DATA:\n${dataBlock(results)}` },
    ], {}, fetchImpl)) {
      text += chunk;
      yield { type: "token", text: chunk };
    }
  } catch (err) {
    yield { type: "error", code: err instanceof OllamaError ? err.code : "error", message: err instanceof OllamaError ? err.message : "The local model failed." };
    return;
  }
  const clean = stripReasoning(text);
  yield { type: "done", text: clean, unverified: verifyAnswer(clean, results).unverified, model: cfg.model };
}
