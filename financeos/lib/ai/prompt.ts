import type { FinancialDataset } from "@/lib/domain/types";
import { DATA_SOURCE_LABELS } from "@/lib/domain/types";
import { formatIsoDate } from "@/lib/domain/dates";
import type { ChatMessage } from "./ollama";
import type { ToolResult } from "./tools";

const BASIS: Record<string, string> = { fact: "recorded", forecast: "FORECAST", assumption: "ASSUMPTION" };

export function systemPrompt(ds: FinancialDataset): string {
  return [
    `You are the AI CFO inside FinanceOS, helping the owner of ${ds.company.name}, a small business. The owner is busy and is not an accountant.`,
    `Data source: ${DATA_SOURCE_LABELS[ds.source]}${ds.source === "demo" ? " (a fictional demonstration company)" : ""}. Reporting date: ${formatIsoDate(ds.asOfDate, "long")}.`,
    "Rules you must follow:",
    "1. Use ONLY the figures given under VERIFIED DATA. Never invent, estimate, recalculate, add up, average or round numbers yourself. Copy figures exactly as written.",
    "2. If the data needed to answer is missing or marked Not available, say so plainly. Do not guess.",
    "3. Items marked FORECAST are projections and items marked ASSUMPTION are inputs that were assumed. Call them projections or assumptions; never present them as facts.",
    "4. The data shows what changed, not why. Do not say whether a change came from prices, volume or anything else. You may suggest what to check.",
    "5. Answer the question directly in the first sentence and include the main figure that answers it (for example the cash balance or the projected cash). Keep it short: a few sentences or a short bullet list. Plain business English. You may use **bold** and bullet lists. No tables, no headings.",
    "6. Mention the reporting date once when giving balances.",
    "7. When useful, end with one practical next step.",
    "8. Base your answer on each Calculated summary; it is correct. If the data states a conclusion, repeat it. Never contradict it, and never reach a different conclusion by comparing numbers yourself.",
    "9. Keep a calm, factual tone. Do not use alarmist words such as crisis, disaster or urgent unless the data uses them.",
    "Earlier messages are context only; take every number from the latest VERIFIED DATA.",
  ].join("\n");
}

export function dataBlock(results: readonly ToolResult[]): string {
  const parts: string[] = [];
  for (const r of results) {
    parts.push(`## ${r.title} (as of ${r.asOfDate}; source: ${r.source})`);
    if (!r.available) {
      parts.push(`Not available: ${r.notes.join(" ")}`);
      continue;
    }
    parts.push(`Calculated summary (correct; do not change its meaning): ${r.summary.replace(/\s+/g, " ").slice(0, 1500)}`);
    for (const f of r.facts) parts.push(`- ${f.label}: ${f.display}${f.basis !== "fact" ? ` [${BASIS[f.basis]}]` : ""}`);
    if (r.table && r.table.rows.length) {
      parts.push(`Table: ${r.table.columns.join(" | ")}`);
      for (const row of r.table.rows.slice(0, 10)) parts.push(`  ${row.join(" | ")}`);
    }
    if (r.assumptions.length) parts.push(`Assumptions: ${r.assumptions.join(" ")}`);
    if (r.notes.length) parts.push(`Notes: ${r.notes.join(" ")}`);
  }
  return parts.join("\n");
}

export interface HistoryTurn {
  role: "user" | "assistant";
  content: string;
}

export function buildMessages(ds: FinancialDataset, question: string, results: readonly ToolResult[], history: readonly HistoryTurn[]): ChatMessage[] {
  const msgs: ChatMessage[] = [{ role: "system", content: systemPrompt(ds) }];
  for (const h of history.slice(-6)) msgs.push({ role: h.role, content: h.content.slice(0, 800) });
  const data = results.length ? dataBlock(results) : "No company financial data was retrieved for this question. Answer only with general finance knowledge and do not state any figures about this company.";
  msgs.push({ role: "user", content: `QUESTION: ${question}\n\nVERIFIED DATA:\n${data}` });
  return msgs;
}
