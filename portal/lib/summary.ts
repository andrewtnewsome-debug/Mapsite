import { CAPITAL_TYPE_LABELS, TIMELINE_LABELS, USE_OF_FUNDS_LABELS, growth, margin, money, pct } from "./format";
import type { AiSummary, NaicsResult, SubmissionInput } from "./types";

/**
 * PLACEHOLDER for the Claude deal summary. Writes a templated analyst-style
 * paragraph from the submitted fields; Phase 1 replaces this with a model call.
 */
export function draftSummary(s: SubmissionInput, naics: NaicsResult, now = new Date()): AiSummary {
  const f = s.financials;
  const m = margin(f.revenueLTM, f.ebitdaLTM);
  const g = growth(f.revenueLTM, f.revenuePrior);
  const years = now.getFullYear() - s.company.yearFounded;
  const industry = naics.title.replace(/\s*\(.*\)$/, "").toLowerCase();

  const growthPhrase =
    g === null ? "" : g >= 0 ? `, up ${pct(g, 1)} year over year` : `, down ${pct(Math.abs(g), 1)} year over year`;

  const ownership = [
    s.ownership.diverseOwned ? "The company is minority-owned" : "The company is not minority-owned",
    s.ownership.ownerOperator ? "and is run day to day by its owner." : "and is managed by a non-owner team.",
  ].join(" ");

  const summary =
    `${s.company.name} is a ${s.company.city}, ${s.company.state}-based business in ${industry} ` +
    `(NAICS ${naics.code}) with roughly ${s.company.employees} employees and ${years} years of operating history. ` +
    `Over the last twelve months it generated ${money(f.revenueLTM)} of revenue${growthPhrase}, and ${money(f.ebitdaLTM)} of EBITDA ` +
    `(a ${pct(m, 1)} margin). Management is seeking ${money(s.deal.amount)} of ${CAPITAL_TYPE_LABELS[s.deal.capitalType].toLowerCase()} ` +
    `for ${USE_OF_FUNDS_LABELS[s.deal.useOfFunds].toLowerCase()}, with a target close ${TIMELINE_LABELS[s.deal.timeline].toLowerCase()}. ` +
    ownership;

  const highlights: string[] = [];
  const risks: string[] = [];

  if (g !== null && g >= 10) highlights.push(`Double-digit top-line growth (${pct(g, 1)} YoY) signals healthy demand.`);
  if (m >= 15) highlights.push(`${pct(m, 1)} EBITDA margin supports debt service and reinvestment.`);
  if (years >= 15) highlights.push(`${years}-year operating history through multiple economic cycles.`);
  if (f.topCustomerPct <= 15) highlights.push(`Diversified customer base; largest customer is ${pct(f.topCustomerPct)} of revenue.`);
  if (f.ebitdaLTM >= 2_000_000) highlights.push(`EBITDA scale of ${money(f.ebitdaLTM)} opens the institutional lender and sponsor market.`);

  if (g !== null && g < 0) risks.push(`Revenue declined ${pct(Math.abs(g), 1)} YoY; lenders will ask what drove the drop.`);
  if (m < 8) risks.push(`Thin ${pct(m, 1)} margin leaves limited cushion for debt service.`);
  if (f.topCustomerPct >= 25) risks.push(`Customer concentration: top customer is ${pct(f.topCustomerPct)} of revenue.`);
  if (f.ebitdaLTM < 500_000) risks.push(`Sub-$500K EBITDA narrows the field to SBA, CDFI, and specialty lenders.`);
  if (s.deal.amount > 4 * Math.max(f.ebitdaLTM, 1)) risks.push(`Ask is large relative to cash flow (${(s.deal.amount / Math.max(f.ebitdaLTM, 1)).toFixed(1)}x EBITDA).`);
  if (years < 5) risks.push(`Limited operating history (${years} years).`);

  if (highlights.length === 0) highlights.push("No standout strengths identified from the submitted figures.");
  if (risks.length === 0) risks.push("No material risks flagged from the submitted figures.");

  return { summary, highlights, risks, generatedAt: now.toISOString(), model: "placeholder" };
}
