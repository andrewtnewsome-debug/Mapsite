/**
 * Deterministic question router: maps a natural-language question to the
 * financial tools (and parameters) needed to answer it. This runs before any
 * language model, so supported questions are answered from verified data even
 * when Ollama is not available.
 */

import type { FinancialDataset } from "@/lib/domain/types";
import { monthNameToNumber } from "@/lib/domain/dates";
import { matchCustomer, monthFromName, type ToolCall, type ToolId } from "./tools";

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fifteen: 15, twenty: 20, thirty: 30, sixty: 60, ninety: 90,
};

function toNumber(token: string): number | null {
  const t = token.toLowerCase();
  if (/^\d+$/.test(t)) return Number(t);
  return NUMBER_WORDS[t] ?? null;
}

const NUM = "(\\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fifteen|twenty|thirty|sixty|ninety)";

export function extractLimit(q: string): number | undefined {
  const m = new RegExp(`\\b(?:top|largest|biggest|first)?\\s*${NUM}\\s+(?:customers|clients|accounts|companies|biggest|largest|names)`, "i").exec(q) ?? new RegExp(`\\btop\\s+${NUM}\\b`, "i").exec(q);
  const n = m ? toNumber(m[1]) : null;
  return n != null && n >= 1 && n <= 25 ? n : undefined;
}

export function extractDays(q: string): number | undefined {
  const m = new RegExp(`${NUM}\\s*\\+?\\s*days?`, "i").exec(q);
  const n = m ? toNumber(m[1]) : null;
  return n != null && n >= 1 && n <= 365 ? n : undefined;
}

export function extractWeeks(q: string): number | undefined {
  const m = new RegExp(`${NUM}\\s*weeks?`, "i").exec(q);
  if (m) {
    const n = toNumber(m[1]);
    if (n != null) return Math.min(13, Math.max(1, n));
  }
  if (/\bnext week\b/i.test(q)) return 1;
  if (/\b(next|in a|one) month\b/i.test(q)) return 4;
  if (/\b(two|2) months\b/i.test(q)) return 9;
  if (/\b(three|3) months\b|\bquarter\b/i.test(q)) return 13;
  return undefined;
}

export function extractPeriod(q: string, asOfDate: string): string | undefined {
  const s = q.toLowerCase();
  if (/\b(ytd|year[- ]to[- ]date|this year)\b/.test(s)) return "ytd";
  if (/\b(last|trailing|past) (12|twelve) months\b|\bttm\b|\blast year\b|\bannual\b/.test(s)) return "ttm";
  if (/\blast quarter\b|\bprevious quarter\b/.test(s)) return "last-quarter";
  if (/\bthis quarter\b|\bcurrent quarter\b/.test(s)) return "this-quarter";
  if (/\blast month\b|\bprevious month\b|\bprior month\b/.test(s)) return "last-month";
  const m = /\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\b(?:\s+(\d{4}))?/.exec(s);
  if (m && !(m[1] === "may" && !/\bin may\b|\bmay \d{4}\b|\bfor may\b/.test(s))) {
    const n = monthNameToNumber(m[1]);
    if (n) return m[2] ? `${m[2]}-${String(n).padStart(2, "0")}` : monthFromName(n, asOfDate);
  }
  return undefined;
}

interface Rule {
  tool: ToolId;
  test: RegExp[];
  /** All patterns in `requireAll` must match as well. */
  requireAll?: RegExp[];
}

const RULES: Rule[] = [
  { tool: "weekly_briefing", test: [/\bbriefing\b/i, /\bweekly (update|summary|report)\b/i, /\bpay(ing)? attention to\b/i, /\bwhat should i (know|focus|watch)\b/i, /\bhow (are|is) (we|the business|the company) doing\b/i, /\bstate of the business\b/i] },
  { tool: "financial_risks", test: [/\brisks?\b/i, /\bworr(y|ied)\b/i, /\bred flags?\b/i, /\bconcerns?\b/i, /\bproblems?\b/i, /\bhealth(y|iness)?\b/i] },
  { tool: "cash_forecast", test: [/\brun out of (cash|money)\b/i, /\bforecast\b/i, /\bproject(ed|ion)?\b.*\bcash\b/i, /\bcash\b.*\b(in|after|over the next) \w+ (weeks?|months?)\b/i, /\bwill we have\b/i, /\bcash runway\b/i, /\brunway\b/i, /\bfuture cash\b/i, /\bnext (week|month|quarter)\b.*\bcash\b/i] },
  { tool: "cash_position", test: [/\bhow much (cash|money)\b/i, /\bcash (balance|position|on hand)\b/i, /\bbank (balance|accounts?)\b/i, /\bin the bank\b/i, /^\s*cash\??\s*$/i] },
  { tool: "collections_priorities", test: [/\bprioriti[sz]e\b/i, /\bfollow up\b/i, /\bcollections?\b/i, /\bchase\b/i, /\bwho should (we|i) (call|contact|email)\b/i] },
  { tool: "ar_over_days", test: [/\bover \d+ days\b/i, /\bolder than\b/i, /\b(more than|over|past) (\d+|thirty|sixty|ninety) days\b/i, /\b\d+\+? days? (old|overdue|past due|late)\b/i] },
  { tool: "top_customers_owed", test: [/\bowe(s)? us the most\b/i, /\b(top|largest|biggest) (\w+ )?(customers|balances|debtors|clients)\b/i, /\bwho owes\b/i, /\bwhich (\w+ )?customers owe\b/i] },
  { tool: "receivables_summary", test: [/\breceivables?\b/i, /\b(a\/r|ar)\b/i, /\boverdue\b/i, /\bpast due\b/i, /\bunpaid invoices\b/i, /\boutstanding invoices\b/i, /\bpercent(age)? of (our )?invoices\b/i, /\bdso\b/i, /\bdays sales\b/i] },
  { tool: "profit_and_loss", test: [/\bprofit(able|ability)?\b/i, /\bnet income\b/i, /\bearn(ed|ings)\b/i, /\bmargins?\b/i, /\bp&l\b|\bp and l\b|\bincome statement\b/i, /\bmake money\b/i, /\brevenue\b.*\b(last|this|in)\b/i, /\bsales\b.*\b(last|this|in)\b/i, /\bhow much did we (make|sell|earn)\b/i] },
  { tool: "expense_changes", test: [/\bexpenses?\b.*\b(increas|ris|grow|up|chang|higher|jump)/i, /\b(increas|ris|grow|chang|higher)\w*\b.*\bexpenses?\b/i, /\bspending\b/i, /\bcosts?\b.*\b(increas|ris|up|higher|chang)/i, /\bwhy (are|is) (our )?(expenses|costs)\b/i, /\bexpenses?\b/i] },
  { tool: "revenue_trend", test: [/\brevenue (trend|growth)\b/i, /\b(is|are) (our )?(revenue|sales) (growing|declining|up|down)\b/i, /\bgrowth\b/i, /\btrend\b/i] },
  { tool: "payables_summary", test: [/\bpayables?\b/i, /\b(a\/p|ap)\b/i, /\bbills?\b/i, /\bvendors?\b/i, /\bwho do we owe\b/i, /\bwhat do we owe\b/i] },
  { tool: "financial_ratios", test: [/\bratios?\b/i, /\bcurrent ratio\b/i, /\bquick ratio\b/i, /\bworking capital\b/i, /\bliquidity\b/i, /\bleverage\b/i, /\bdebt\b/i, /\bbalance sheet\b/i, /\bsolven(t|cy)\b/i] },
];

export interface RouteResult {
  calls: ToolCall[];
  /** Which rules matched, for transparency and tests. */
  matched: ToolId[];
}

export function routeQuestion(question: string, ds: FinancialDataset): RouteResult {
  const q = question.trim();
  const calls: ToolCall[] = [];
  const add = (id: ToolId, params: ToolCall["params"] = {}) => {
    if (!calls.some((c) => c.id === id)) calls.push({ id, params });
  };

  // A named customer takes precedence for balance questions.
  const customer = matchCustomer(ds, q);
  if (customer) add("customer_balance", { customer: customer.name });

  for (const rule of RULES) {
    if (!rule.test.some((r) => r.test(q))) continue;
    if (rule.requireAll && !rule.requireAll.every((r) => r.test(q))) continue;
    switch (rule.tool) {
      case "top_customers_owed":
        add("top_customers_owed", { limit: extractLimit(q) ?? 5, overdueOnly: /\boverdue|past due|late\b/i.test(q) });
        break;
      case "ar_over_days":
        add("ar_over_days", { days: extractDays(q) ?? 60 });
        break;
      case "collections_priorities":
        add("collections_priorities", { limit: extractLimit(q) ?? 5 });
        break;
      case "cash_forecast":
        add("cash_forecast", { weeks: extractWeeks(q) ?? 13 });
        break;
      case "profit_and_loss":
        add("profit_and_loss", { period: extractPeriod(q, ds.asOfDate) ?? "last-month" });
        break;
      case "receivables_summary":
        if (customer && !/\btotal|all|our\b/i.test(q)) break;
        add("receivables_summary");
        break;
      default:
        add(rule.tool);
    }
  }

  // Briefings and risk questions already include the components; keep the answer focused.
  if (calls.some((c) => c.id === "weekly_briefing")) {
    return { calls: calls.filter((c) => c.id === "weekly_briefing"), matched: calls.map((c) => c.id) };
  }
  // "top customers overdue" makes a separate receivables summary redundant.
  const ids = calls.map((c) => c.id);
  let pruned = calls;
  if (ids.includes("top_customers_owed") || ids.includes("ar_over_days") || ids.includes("customer_balance") || ids.includes("collections_priorities")) {
    if (!/\b(percent|percentage|total|how much)\b.*\b(ar|receivable|overdue)/i.test(q)) pruned = pruned.filter((c) => c.id !== "receivables_summary");
  }
  if (ids.includes("ar_over_days")) pruned = pruned.filter((c) => c.id !== "collections_priorities" || /prioriti|follow up|chase/i.test(q));
  if (ids.includes("expense_changes") && !/\b(profit|net income|margin)\b/i.test(q)) pruned = pruned.filter((c) => c.id !== "profit_and_loss");
  return { calls: pruned.slice(0, 4), matched: ids };
}

/** Short follow-ups like "what about last quarter?" reuse the previous tools with new parameters. */
export function routeFollowUp(question: string, previous: ToolCall[], ds: FinancialDataset): ToolCall[] | null {
  if (previous.length === 0) return null;
  if (!/^\s*(and|what about|how about|same for|now|ok(ay)?|also|vs|versus|compared)/i.test(question) && question.split(/\s+/).length > 6) return null;
  const period = extractPeriod(question, ds.asOfDate);
  const weeks = extractWeeks(question);
  const days = extractDays(question);
  const limit = extractLimit(question);
  const customer = matchCustomer(ds, question);
  if (!period && !weeks && !days && !limit && !customer) return null;
  return previous.map((c) => ({
    id: customer && (c.id === "top_customers_owed" || c.id === "customer_balance") ? "customer_balance" : c.id,
    params: {
      ...c.params,
      ...(period && c.id === "profit_and_loss" ? { period } : {}),
      ...(weeks && c.id === "cash_forecast" ? { weeks } : {}),
      ...(days && c.id === "ar_over_days" ? { days } : {}),
      ...(limit && (c.id === "top_customers_owed" || c.id === "collections_priorities") ? { limit } : {}),
      ...(customer && (c.id === "top_customers_owed" || c.id === "customer_balance") ? { customer: customer.name } : {}),
    },
  }));
}

export const SUPPORTED_QUESTIONS = [
  "How much cash do we have?",
  "Who owes us money?",
  "Which five customers owe us the most money?",
  "How much of our AR is over 60 days old?",
  "What percentage of our invoices are overdue?",
  "Which customers should we prioritize for collections?",
  "What was our net income last month?",
  "How profitable were we last quarter?",
  "What expenses have increased?",
  "How much cash will we have in eight weeks?",
  "Are we going to run out of cash?",
  "What are the biggest financial risks facing the company?",
  "Give me a weekly CFO briefing.",
  "What do we owe vendors?",
];
