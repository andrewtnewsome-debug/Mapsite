import type { ToolId } from "./tools";

const FOLLOW_UPS: Record<ToolId, string[]> = {
  cash_position: ["Are we going to run out of cash?", "How much cash will we have in eight weeks?", "Who owes us money?"],
  receivables_summary: ["Which customers should we prioritize for collections?", "How much of our AR is over 60 days old?", "Which five customers owe us the most money?"],
  top_customers_owed: ["Which customers should we prioritize for collections?", "How much of our AR is over 90 days old?", "What percentage of our invoices are overdue?"],
  ar_over_days: ["Which customers should we prioritize for collections?", "How much of our AR is over 30 days old?", "Are we going to run out of cash?"],
  customer_balance: ["Which customers should we prioritize for collections?", "Which five customers owe us the most money?"],
  collections_priorities: ["How much of our AR is over 60 days old?", "How much cash will we have in eight weeks?", "What percentage of our invoices are overdue?"],
  profit_and_loss: ["What expenses have increased?", "How profitable were we year to date?", "Is our revenue growing?"],
  expense_changes: ["What was our net income last month?", "What are the biggest financial risks facing the company?"],
  revenue_trend: ["What was our net income last month?", "What expenses have increased?"],
  cash_forecast: ["What are the biggest financial risks facing the company?", "Which customers should we prioritize for collections?", "How much cash do we have?"],
  payables_summary: ["How much cash do we have?", "Are we going to run out of cash?"],
  financial_ratios: ["What are the biggest financial risks facing the company?", "Give me a weekly CFO briefing."],
  financial_risks: ["Which customers should we prioritize for collections?", "What expenses have increased?", "How much cash will we have in eight weeks?"],
  weekly_briefing: ["Which customers should we prioritize for collections?", "What expenses have increased?", "Are we going to run out of cash?"],
};

export function followUpsFor(tools: readonly ToolId[], asked: string): string[] {
  const seen = new Set<string>([asked.trim().toLowerCase()]);
  const out: string[] = [];
  for (const t of tools) {
    for (const q of FOLLOW_UPS[t] ?? []) {
      if (seen.has(q.toLowerCase())) continue;
      seen.add(q.toLowerCase());
      out.push(q);
    }
  }
  return out.slice(0, 3);
}
