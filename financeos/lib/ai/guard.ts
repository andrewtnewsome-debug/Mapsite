/**
 * Number guard: checks that every financial figure in a model's answer
 * matches a verified figure that FinanceOS supplied. Figures that do not match
 * are reported to the user as unverified.
 */

import type { ToolResult } from "./tools";

export interface Verification {
  checked: number;
  unverified: string[];
}

interface Allowed {
  money: number[];
  percents: number[];
  plain: number[];
}

const MONEY_RE = /(-|−)?\$\s?(\d[\d,]*(?:\.\d+)?)\s?(k|m|mm|million|thousand|bn|billion)?\b/gi;
const PERCENT_RE = /(-|−|\+)?(\d+(?:\.\d+)?)\s?%/g;
const PLAIN_RE = /(?<![\w$.,-])(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d{3,}(?:\.\d+)?)(?![\w%])/g;

function numbersIn(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(/-?\d[\d,]*(?:\.\d+)?/g)) {
    const n = Number(m[0].replace(/,/g, ""));
    if (Number.isFinite(n)) out.push(Math.abs(n));
  }
  return out;
}

export function allowedNumbers(results: readonly ToolResult[], extraText: string[] = []): Allowed {
  const money: number[] = [];
  const percents: number[] = [];
  const plain: number[] = [];
  const texts: string[] = [...extraText];
  for (const r of results) {
    texts.push(r.summary, r.title, r.asOfDate, ...r.assumptions, ...r.notes);
    if (r.table) texts.push(...r.table.rows.flat(), ...r.table.columns);
    for (const f of r.facts) {
      texts.push(f.display, f.label);
      if (typeof f.value !== "number") continue;
      const v = Math.abs(f.value);
      if (f.kind === "currency") money.push(v);
      else if (f.kind === "percent") percents.push(v * 100);
      else plain.push(v);
    }
  }
  for (const t of texts) {
    for (const m of t.matchAll(MONEY_RE)) money.push(scale(Number(m[2].replace(/,/g, "")), m[3]));
    for (const m of t.matchAll(PERCENT_RE)) percents.push(Number(m[2]));
    plain.push(...numbersIn(t));
  }
  return { money, percents, plain };
}

function scale(n: number, suffix?: string): number {
  const s = (suffix ?? "").toLowerCase();
  if (s === "k" || s === "thousand") return n * 1_000;
  if (s === "m" || s === "mm" || s === "million") return n * 1_000_000;
  if (s === "bn" || s === "billion") return n * 1_000_000_000;
  return n;
}

function closeMoney(token: number, approximate: boolean, allowed: number[]): boolean {
  return allowed.some((a) => {
    const tol = approximate ? Math.max(1, Math.abs(a) * 0.006) : 1;
    return Math.abs(token - a) <= tol;
  });
}

export function verifyAnswer(answer: string, results: readonly ToolResult[], extraText: string[] = []): Verification {
  const allowed = allowedNumbers(results, extraText);
  const unverified = new Set<string>();
  let checked = 0;
  // Money
  for (const m of answer.matchAll(MONEY_RE)) {
    const raw = m[0].trim();
    const digits = m[2].replace(/,/g, "");
    const value = scale(Number(digits), m[3]);
    if (!Number.isFinite(value)) continue;
    checked += 1;
    const approximate = Boolean(m[3]) || /000$/.test(digits.split(".")[0]) || /^(about|approximately|roughly|around|nearly|almost|over|under)\s*$/i.test(answer.slice(Math.max(0, (m.index ?? 0) - 14), m.index).trim().split(/\s+/).pop() ?? "");
    if (!closeMoney(value, approximate, allowed.money)) unverified.add(raw);
  }
  // Percentages
  for (const m of answer.matchAll(PERCENT_RE)) {
    const v = Number(m[2]);
    checked += 1;
    const decimals = (m[2].split(".")[1] ?? "").length;
    const tol = decimals === 0 ? 0.51 : decimals === 1 ? 0.051 : 0.006;
    if (!allowed.percents.some((a) => Math.abs(Math.abs(a) - v) <= tol)) unverified.add(m[0].trim());
  }
  // Large plain numbers (e.g. "1,140,886" without a $). Small integers, years and day counts are allowed.
  const withoutMoneyAndPct = answer.replace(MONEY_RE, " ").replace(PERCENT_RE, " ");
  for (const m of withoutMoneyAndPct.matchAll(PLAIN_RE)) {
    const v = Number(m[1].replace(/,/g, ""));
    if (v >= 1900 && v <= 2100 && !m[1].includes(",")) continue; // years
    checked += 1;
    if (!allowed.plain.some((a) => Math.abs(a - v) <= 0.5) && !allowed.money.some((a) => Math.abs(a - v) <= 1)) unverified.add(m[1]);
  }
  return { checked, unverified: [...unverified].slice(0, 10) };
}
