/**
 * AI CFO evaluation harness.
 *
 *   npm run eval:ai                 # uses OLLAMA_BASE_URL / OLLAMA_MODEL (defaults: 127.0.0.1:11434, qwen3:4b)
 *   npm run eval:ai -- --model qwen3:1.7b --limit 5
 *
 * Runs a fixed question set against the fictional demo company through the
 * real answer pipeline and scores:
 *   - routing:   the expected financial tools were selected
 *   - figures:   every figure in the answer matched a verified figure (number guard)
 *   - grounding: the answer contains the key verified figure for the question
 *   - latency
 * Works without Ollama too (scores routing and deterministic answers only).
 * Writes a Markdown report to .data/eval/.
 */

import fs from "node:fs";
import path from "node:path";
import { answerQuestion, type ChatEvent } from "../lib/ai/answer";
import { getOllamaStatus, validateOllamaConfig } from "../lib/ai/ollama";
import type { ToolId, ToolResult } from "../lib/ai/tools";
import { todayLocalIso } from "../lib/domain/dates";
import { buildDemoDataset } from "../lib/demo/generate";

interface Case {
  question: string;
  expect: ToolId[];
  /** Label (prefix) of the fact whose value a correct answer should state. */
  keyFact?: string;
}

const CASES: Case[] = [
  { question: "How much cash do we have?", expect: ["cash_position"], keyFact: "Total book cash balance" },
  { question: "Who owes us money?", expect: ["top_customers_owed"], keyFact: "#1 " },
  { question: "Which customers should we follow up with?", expect: ["collections_priorities"], keyFact: "#1 " },
  { question: "How profitable were we last month?", expect: ["profit_and_loss"], keyFact: "Net income," },
  { question: "Are we going to run out of cash?", expect: ["cash_forecast"], keyFact: "Base case projected cash" },
  { question: "Why are our expenses increasing?", expect: ["expense_changes"] },
  { question: "What should I be paying attention to this week?", expect: ["weekly_briefing"] },
  { question: "Which five customers owe us the most money?", expect: ["top_customers_owed"], keyFact: "#1 " },
  { question: "How much of our AR is over 60 days old?", expect: ["ar_over_days"], keyFact: "Balance more than 60" },
  { question: "What was our net income last month?", expect: ["profit_and_loss"], keyFact: "Net income," },
  { question: "What percentage of our invoices are overdue?", expect: ["receivables_summary"], keyFact: "Share of open invoices that are overdue" },
  { question: "What expenses have increased?", expect: ["expense_changes"] },
  { question: "How much cash will we have in eight weeks?", expect: ["cash_forecast"], keyFact: "Base case projected cash at week 8" },
  { question: "Which customers should we prioritize for collections?", expect: ["collections_priorities"], keyFact: "#1 " },
  { question: "What are the biggest financial risks facing the company?", expect: ["financial_risks"] },
  { question: "Give me a weekly CFO briefing.", expect: ["weekly_briefing"] },
  { question: "How much does Granite Peak owe us?", expect: ["customer_balance"], keyFact: "Granite Peak Properties total owed" },
  { question: "What do we owe our vendors?", expect: ["payables_summary"], keyFact: "Total accounts payable" },
  { question: "Is our balance sheet healthy?", expect: ["financial_ratios"] },
];

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

function normalize(s: string): string {
  return s.replace(/[*_`]/g, "").replace(/\s+/g, " ");
}

/** True when the answer states the key figure (exact display, or a rounded $K/$M form within 1%). */
function mentionsFact(answer: string, results: ToolResult[], keyFact: string | undefined): boolean | null {
  if (!keyFact) return null;
  const fact = results.flatMap((r) => r.facts).find((f) => f.label.startsWith(keyFact));
  if (!fact) return null;
  const a = normalize(answer);
  if (a.includes(fact.display)) return true;
  if (typeof fact.value !== "number") return false;
  const target = fact.kind === "percent" ? fact.value * 100 : fact.value;
  const re = fact.kind === "percent" ? /(\d+(?:\.\d+)?)\s?%/g : /\$\s?(\d[\d,]*(?:\.\d+)?)\s?(k|m|million|thousand)?/gi;
  for (const m of a.matchAll(re)) {
    let n = Number(m[1].replace(/,/g, ""));
    const s = (m[2] ?? "").toLowerCase();
    if (s === "k" || s === "thousand") n *= 1_000;
    if (s === "m" || s === "million") n *= 1_000_000;
    if (Math.abs(n - Math.abs(target)) <= Math.max(0.06, Math.abs(target) * 0.01)) return true;
  }
  return false;
}

async function main() {
  const asOf = arg("as-of") ?? todayLocalIso();
  const limit = Number(arg("limit") ?? CASES.length);
  const cfg = validateOllamaConfig({ baseUrl: arg("url") ?? process.env.OLLAMA_BASE_URL, model: arg("model") ?? process.env.OLLAMA_MODEL, timeoutSeconds: arg("timeout") ?? process.env.OLLAMA_TIMEOUT_SECONDS ?? 600 });
  const status = await getOllamaStatus(cfg);
  const dataset = buildDemoDataset(asOf);
  const aiMode = status.running && status.modelInstalled;
  console.log(`FinanceOS AI evaluation · demo company as of ${asOf} · ${aiMode ? `model ${cfg.model} (Ollama ${status.version})` : `NO MODEL (${status.error ?? `model ${cfg.model} not installed`}) - deterministic mode`}`);

  const rows: { q: string; routing: boolean; mode: string; ms: number; checked: number; unverified: string[]; grounded: boolean | null; tools: string; answer: string; error: string | null }[] = [];
  for (const c of CASES.slice(0, limit)) {
    const started = Date.now();
    const events: ChatEvent[] = [];
    let error: string | null = null;
    try {
      for await (const e of answerQuestion({ question: c.question, history: [], previousCalls: [], dataset, ollama: cfg })) events.push(e);
    } catch (err) {
      error = (err as Error).message;
    }
    const ms = Date.now() - started;
    const meta = events.find((e): e is Extract<ChatEvent, { type: "meta" }> => e.type === "meta");
    const done = events.find((e): e is Extract<ChatEvent, { type: "done" }> => e.type === "done");
    const errEvent = events.find((e): e is Extract<ChatEvent, { type: "error" }> => e.type === "error");
    const tools = meta?.calls.map((x) => x.id) ?? [];
    const row = {
      q: c.question,
      routing: c.expect.every((t) => tools.includes(t)),
      mode: done?.mode ?? "none",
      ms,
      checked: done?.verification?.checked ?? 0,
      unverified: done?.verification?.unverified ?? [],
      grounded: done && done.mode === "ai" ? mentionsFact(done.answer, meta?.results ?? [], c.keyFact) : null,
      tools: tools.join(", "),
      answer: done?.answer ?? "",
      error: error ?? errEvent?.message ?? null,
    };
    rows.push(row);
    console.log(`${row.routing ? "PASS" : "FAIL"} route | ${row.mode.padEnd(13)} | ${String(ms).padStart(6)} ms | figures ${row.checked - row.unverified.length}/${row.checked}${row.unverified.length ? ` UNVERIFIED: ${row.unverified.join(" ")}` : ""}${row.grounded === false ? " | KEY FIGURE MISSING" : ""} | ${c.question}`);
    if (row.error) console.log(`      error: ${row.error}`);
  }

  const ai = rows.filter((r) => r.mode === "ai");
  const summary = {
    questions: rows.length,
    routingPass: rows.filter((r) => r.routing).length,
    aiAnswers: ai.length,
    answersWithUnverifiedFigures: ai.filter((r) => r.unverified.length > 0).length,
    figuresChecked: ai.reduce((s, r) => s + r.checked, 0),
    figuresUnverified: ai.reduce((s, r) => s + r.unverified.length, 0),
    keyFigureMissing: ai.filter((r) => r.grounded === false).length,
    medianLatencyMs: ai.length ? ai.map((r) => r.ms).sort((a, b) => a - b)[Math.floor(ai.length / 2)] : null,
    errors: rows.filter((r) => r.error).length,
  };
  console.log("\nSummary:", JSON.stringify(summary, null, 2));

  const dir = path.join(process.cwd(), ".data", "eval");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `ai-eval-${new Date().toISOString().replace(/[:.]/g, "-")}.md`);
  const md = [
    `# FinanceOS AI evaluation`,
    ``,
    `- Date: ${new Date().toISOString()}`,
    `- Data: fictional demo company as of ${asOf}`,
    `- Model: ${aiMode ? `${cfg.model} via Ollama ${status.version}` : "none (deterministic mode)"}`,
    ``,
    "```json",
    JSON.stringify(summary, null, 2),
    "```",
    ``,
    ...rows.flatMap((r) => [
      `## ${r.q}`,
      ``,
      `- Routing: ${r.routing ? "pass" : "FAIL"} (${r.tools || "no tools"})`,
      `- Mode: ${r.mode}; latency ${r.ms} ms; figures verified ${r.checked - r.unverified.length}/${r.checked}${r.unverified.length ? `; unverified: ${r.unverified.join(", ")}` : ""}${r.grounded === null ? "" : `; key figure ${r.grounded ? "present" : "MISSING"}`}`,
      r.error ? `- Error: ${r.error}` : "",
      ``,
      r.answer
        .split("\n")
        .map((l) => `> ${l}`)
        .join("\n"),
      ``,
    ]),
  ].join("\n");
  fs.writeFileSync(file, md, "utf8");
  console.log(`\nReport: ${file}`);
  if (summary.routingPass < summary.questions || summary.errors > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
