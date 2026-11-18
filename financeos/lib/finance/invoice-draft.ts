/**
 * Invoice drafting from a plain-English description.
 *
 * The rule-based parser extracts the customer, line items (quantity, unit
 * price, description) and due terms. Totals are always computed here, never
 * by a language model. Drafts are local only; nothing is created in QuickBooks.
 */

import { z } from "zod";
import { addDays, isIsoDate, monthNameToNumber } from "@/lib/domain/dates";
import { roundCents, sum } from "@/lib/domain/money";

export const DraftLineSchema = z.object({
  id: z.string().max(40),
  description: z.string().trim().max(300),
  quantity: z.number().finite().min(0).max(1_000_000),
  unitPrice: z.number().finite().min(-1e9).max(1e9),
});

export const InvoiceDraftSchema = z.object({
  customerId: z.string().max(60).nullable(),
  customerName: z.string().trim().max(200),
  invoiceDate: z.string().refine(isIsoDate, "Invalid date"),
  dueDate: z.string().refine(isIsoDate, "Invalid date"),
  terms: z.string().max(60),
  lines: z.array(DraftLineSchema).min(1).max(100),
  memo: z.string().max(1000),
});

export type DraftLine = z.infer<typeof DraftLineSchema>;
export type InvoiceDraft = z.infer<typeof InvoiceDraftSchema>;

export interface CustomerOption {
  id: string;
  name: string;
  /** Typical payment terms in days, from past invoices. */
  termsDays: number | null;
}

export interface ParseResult {
  draft: InvoiceDraft;
  warnings: string[];
  matched: { customer: boolean; lines: number; due: boolean };
}

const WORD_NUMBERS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, forty: 40, fifty: 50, hundred: 100,
};

function qty(token: string): number | null {
  const t = token.toLowerCase();
  if (/^\d+(\.\d+)?$/.test(t)) return Number(t);
  return WORD_NUMBERS[t] ?? null;
}

const money = (s: string) => Number(s.replace(/[,$\s]/g, ""));

function tidy(desc: string): string {
  const d = desc
    .replace(/^(of|for|the)\s+/i, "")
    .replace(/\s+(each|apiece|total)$/i, "")
    .replace(/[.,;]+$/, "")
    .trim();
  return d.charAt(0).toUpperCase() + d.slice(1);
}

let lineSeq = 0;
export function newLineId(): string {
  lineSeq += 1;
  return `ln-${Date.now().toString(36)}-${lineSeq}`;
}

const QTY = "(\\d+(?:\\.\\d+)?|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|hundred)";
const PRICE = "\\$?\\s?([\\d,]+(?:\\.\\d{1,2})?)";

/** Parse one clause into a line item. */
export function parseLineClause(clause: string): Omit<DraftLine, "id"> | null {
  const c = clause.trim().replace(/\s+/g, " ");
  if (!c) return null;
  let m = new RegExp(`^${QTY}\\s*(hours?|hrs?|days?)\\s+(?:of\\s+)?(.+?)\\s+(?:at|@)\\s*${PRICE}\\s*(?:\\/|per|an|a)?\\s*(?:hour|hr|day)?$`, "i").exec(c);
  if (m && qty(m[1]) != null) return { quantity: qty(m[1])!, description: `${tidy(m[3])} (${/day/i.test(m[2]) ? "days" : "hours"})`, unitPrice: money(m[4]) };
  m = new RegExp(`^${QTY}\\s+(.+?)\\s+(?:at|@)\\s*${PRICE}\\s*(?:each|apiece|per\\s+\\w+|\\/\\s*\\w+)?$`, "i").exec(c);
  if (m && qty(m[1]) != null) return { quantity: qty(m[1])!, description: tidy(m[2]), unitPrice: money(m[3]) };
  m = new RegExp(`^${PRICE}\\s+(?:for\\s+)?(.+)$`, "i").exec(c);
  if (m && /\$/.test(c.split(" ")[0])) return { quantity: 1, description: tidy(m[2]), unitPrice: money(m[1]) };
  m = new RegExp(`^(.+?)\\s+(?:for|at|@|:|-)\\s*${PRICE}$`, "i").exec(c);
  if (m) {
    const lead = new RegExp(`^${QTY}\\s+(.+)$`, "i").exec(m[1]);
    // "3 filters for $120" means $120 in total for the line.
    if (lead && qty(lead[1]) != null && qty(lead[1])! > 1) return { quantity: qty(lead[1])!, description: tidy(lead[2]), unitPrice: roundCents(money(m[2]) / qty(lead[1])!) };
    return { quantity: 1, description: tidy(m[1]), unitPrice: money(m[2]) };
  }
  return null;
}

function matchCustomerName(text: string, customers: CustomerOption[]): CustomerOption | null {
  const q = ` ${text.toLowerCase().replace(/[^a-z0-9& ]/g, " ")} `;
  const stop = new Set(["the", "inc", "llc", "co", "group", "and", "of", "company", "services", "corp", "ltd", "center", "partners"]);
  const sig = (name: string) => name.toLowerCase().replace(/[^a-z0-9& ]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !stop.has(w));
  const firstWordCount = new Map<string, number>();
  for (const c of customers) {
    const w = sig(c.name)[0];
    if (w) firstWordCount.set(w, (firstWordCount.get(w) ?? 0) + 1);
  }
  let best: { c: CustomerOption; score: number } | null = null;
  for (const c of customers) {
    const name = c.name.toLowerCase().replace(/[^a-z0-9& ]/g, " ").replace(/\s+/g, " ").trim();
    if (q.includes(` ${name} `)) return c;
    const words = sig(c.name);
    const hits = words.filter((w) => q.includes(` ${w} `)).length;
    let score = words.length ? hits / words.length : 0;
    // A distinctive first word (e.g. "Bluewater") is enough when no other customer shares it.
    if (words[0] && words[0].length >= 5 && firstWordCount.get(words[0]) === 1 && q.includes(` ${words[0]} `)) score = Math.max(score, 0.75);
    if (hits > 0 && score >= 0.5 && (!best || score > best.score)) best = { c, score };
  }
  return best?.c ?? null;
}

function parseDue(text: string, today: string): { dueDate: string; terms: string } | null {
  const t = text.toLowerCase();
  let m = /\bnet\s*(\d{1,3})\b/.exec(t);
  if (m) return { dueDate: addDays(today, Number(m[1])), terms: `Net ${m[1]}` };
  m = /\bdue\s+in\s+(\d{1,3})\s+days?\b/.exec(t);
  if (m) return { dueDate: addDays(today, Number(m[1])), terms: `Net ${m[1]}` };
  if (/\bdue\s+(on|upon)\s+receipt\b|\bdue\s+now\b|\bdue\s+immediately\b/.test(t)) return { dueDate: today, terms: "Due on receipt" };
  m = /\bdue\s+(?:on|by)?\s*(\d{4}-\d{2}-\d{2})\b/.exec(t);
  if (m && isIsoDate(m[1])) return { dueDate: m[1], terms: "Custom" };
  m = /\bdue\s+(?:on|by)?\s*(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(\d{4}))?/.exec(t);
  if (m) {
    const month = monthNameToNumber(m[1]);
    if (month) {
      let year = m[3] ? Number(m[3]) : Number(today.slice(0, 4));
      let iso = `${year}-${String(month).padStart(2, "0")}-${String(Number(m[2])).padStart(2, "0")}`;
      if (!m[3] && isIsoDate(iso) && iso < today) {
        year += 1;
        iso = `${year}-${String(month).padStart(2, "0")}-${String(Number(m[2])).padStart(2, "0")}`;
      }
      if (isIsoDate(iso)) return { dueDate: iso, terms: "Custom" };
    }
  }
  return null;
}

/** Splits the item portion of a request into clauses. */
function itemClauses(text: string, customerName: string | null): string[] {
  let body = text.replace(/\b(net\s*\d+|due\s+in\s+\d+\s+days?|due\s+(on|upon|by)?\s*[^,.;]*)/gi, " ");
  if (customerName) {
    body = body.replace(new RegExp(customerName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "ig"), " ");
    // Also remove a partial mention (first occurrence of each word of the name).
    for (const w of customerName.split(/\s+/).filter((x) => x.length >= 2)) body = body.replace(new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i"), " ");
  }
  body = body.replace(/^\s*(please\s+)?(create|draft|prepare|make|send)?\s*(an?\s+)?(invoice|bill)\s*(to|for)?\s*/i, "");
  body = body.replace(/^\s*(bill|invoice|charge)\s+/i, "");
  body = body.replace(/^\s*(for|to)\s+/i, "");
  return body
    .split(/\s*(?:,(?!\d{3}(?:\D|$))|;|\bplus\b|\band\b(?=\s+(?:\d|\$|a\b|an\b|one|two|three|four|five|six|seven|eight|nine|ten|twelve|twenty)))\s*/i)
    .map((s) => s.replace(/^\s*(for|and|with)\s+/i, "").trim())
    .filter((s) => s.length > 1);
}

export function parseInvoiceRequest(text: string, customers: CustomerOption[], today: string): ParseResult {
  const warnings: string[] = [];
  const customer = matchCustomerName(text, customers);
  if (!customer) warnings.push("No matching customer was found. Choose the customer below.");
  const due = parseDue(text, today);
  const termsDays = customer?.termsDays ?? 30;
  if (!due) warnings.push(`No due date or terms were mentioned; using Net ${termsDays}${customer?.termsDays ? ` (this customer's usual terms)` : ""}.`);
  const lines: DraftLine[] = [];
  for (const clause of itemClauses(text, customer?.name ?? null)) {
    const l = parseLineClause(clause);
    if (l && l.description && l.unitPrice >= 0) lines.push({ id: newLineId(), ...l });
  }
  if (lines.length === 0) {
    warnings.push("No line items with a quantity and price were recognized. Add them below, or try the local AI parser.");
    lines.push({ id: newLineId(), description: "", quantity: 1, unitPrice: 0 });
  }
  return {
    draft: {
      customerId: customer?.id ?? null,
      customerName: customer?.name ?? "",
      invoiceDate: today,
      dueDate: due?.dueDate ?? addDays(today, termsDays),
      terms: due?.terms ?? `Net ${termsDays}`,
      lines,
      memo: "",
    },
    warnings,
    matched: { customer: Boolean(customer), lines: lines.filter((l) => l.description).length, due: Boolean(due) },
  };
}

export interface InvoiceTotals {
  lines: (DraftLine & { amount: number })[];
  subtotal: number;
  total: number;
}

export function computeInvoiceTotals(draft: Pick<InvoiceDraft, "lines">): InvoiceTotals {
  const lines = draft.lines.map((l) => ({ ...l, amount: roundCents(l.quantity * l.unitPrice) }));
  const subtotal = sum(lines.map((l) => l.amount));
  return { lines, subtotal, total: subtotal };
}

/** Typical terms (median days from invoice to due date) per customer. */
export function customerTerms(invoices: { customerId: string; txnDate: string; dueDate: string | null }[]): Map<string, number> {
  const by = new Map<string, number[]>();
  for (const i of invoices) {
    if (!i.dueDate) continue;
    const d = Math.round((Date.parse(i.dueDate) - Date.parse(i.txnDate)) / 86_400_000);
    if (d < 0 || d > 180) continue;
    const arr = by.get(i.customerId) ?? [];
    arr.push(d);
    by.set(i.customerId, arr);
  }
  const out = new Map<string, number>();
  for (const [id, arr] of by) {
    arr.sort((a, b) => a - b);
    out.set(id, arr[Math.floor(arr.length / 2)]);
  }
  return out;
}
