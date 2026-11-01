import { CAPITAL_TYPE_LABELS, TIMELINE_LABELS, USE_OF_FUNDS_LABELS, growth, lowerFirst, margin, money, pct } from "./format";
import { underwriting } from "./scoring";
import type { AiSummary, CimExtraction, NaicsResult, SubmissionInput } from "./types";

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

  const summary =
    `${s.company.name} is a ${s.company.city}, ${s.company.state}-based business in ${industry} ` +
    `(NAICS ${naics.code}) with roughly ${s.company.employees} employees and ${years} years of operating history. ` +
    `Over the last twelve months it generated ${money(f.revenueLTM)} of revenue${growthPhrase}, and ${money(f.ebitdaLTM)} of EBITDA ` +
    `(a ${pct(m, 1)} margin). ` +
    raiseSentence(s);

  const highlights: string[] = [];
  const risks: string[] = [];

  if (g !== null && g >= 10) highlights.push(`Double-digit top-line growth (${pct(g, 1)} YoY) signals healthy demand.`);
  if (m >= 15) highlights.push(`${pct(m, 1)} EBITDA margin supports debt service and reinvestment.`);
  if (years >= 15) highlights.push(`${years}-year operating history through multiple economic cycles.`);
  if (f.topCustomerPct <= 15) highlights.push(`Diversified customer base; largest customer is ${pct(f.topCustomerPct)} of revenue.`);
  if (f.ebitdaLTM >= 2_000_000) highlights.push(`EBITDA scale of ${money(f.ebitdaLTM)} opens the institutional lender and sponsor market.`);

  if (g !== null && g < 0) risks.push(`Revenue declined ${pct(Math.abs(g), 1)} YoY; capital providers will ask what drove the drop.`);
  if (m < 8) risks.push(`Thin ${pct(m, 1)} margin leaves limited cushion for debt service.`);
  if (f.topCustomerPct >= 25) risks.push(`Customer concentration: top customer is ${pct(f.topCustomerPct)} of revenue.`);
  if (f.ebitdaLTM < 500_000) risks.push(`Sub-$500K EBITDA narrows the field to SBA, CDFI, and specialty lenders.`);
  // Judge the ask against the cash flow lenders will underwrite: combined for an add-on.
  const cashFlow = Math.max(underwriting(s).ebitdaLTM, 1);
  if (s.deal.amount > 4 * cashFlow) risks.push(`Ask is large relative to cash flow (${(s.deal.amount / cashFlow).toFixed(1)}x EBITDA).`);
  if (years < 5) risks.push(`Limited operating history (${years} years).`);

  if (highlights.length === 0) highlights.push("No standout strengths identified from the submitted figures.");
  if (risks.length === 0) risks.push("No material risks flagged from the submitted figures.");

  return { summary, highlights, risks, generatedAt: now.toISOString(), model: "placeholder" };
}

/** The ask, who is behind it, and who will own the business. Shared by the placeholder and the CIM summary. */
function raiseSentence(s: SubmissionInput): string {
  const capital = `${money(s.deal.amount)} of ${lowerFirst(CAPITAL_TYPE_LABELS[s.deal.capitalType])}`;
  const timing = `with a target close ${TIMELINE_LABELS[s.deal.timeline].toLowerCase()}`;
  if (s.deal.useOfFunds !== "acquisition") {
    return (
      `Management is seeking ${capital} for ${USE_OF_FUNDS_LABELS[s.deal.useOfFunds].toLowerCase()}, ${timing}. ` +
      (s.ownership.diverseOwned ? "The company is minority-owned" : "The company is not minority-owned") +
      (s.ownership.ownerOperator ? " and is run day to day by its owner." : " and is managed by a non-owner team.")
    );
  }
  const a = s.acquirer;
  const price = s.deal.purchasePrice ? ` at a ${money(s.deal.purchasePrice)} purchase price` : "";
  const buyer = a?.ownsBusiness && a.current
    ? `The buyer owns ${a.current.name} (${money(a.current.revenueLTM)} revenue, ${money(a.current.ebitdaLTM)} EBITDA)` +
      (a.combine ? " and plans to combine the two businesses." : " and will run the acquisition as a separate company.")
    : "The buyer is a first-time acquirer.";
  const after = s.ownership.diverseOwned ? "After closing the business will be minority-owned" : "After closing the business will not be minority-owned";
  return (
    `The buyer is seeking ${capital} to fund the acquisition${price}, ${timing}. ${buyer} ` +
    `${after}${s.ownership.ownerOperator ? " and run day to day by its owner." : "."}`
  );
}

/** The deal summary when Claude has read a CIM: Claude's own summary, facts and risks, plus the ask from the form. */
export function summaryFromCim(s: SubmissionInput, cim: CimExtraction, now = new Date()): AiSummary {
  return {
    summary: `${cim.summary} ${raiseSentence(s)}`.trim(),
    highlights: cim.keyFacts.length ? cim.keyFacts : ["The CIM did not surface standout strengths."],
    risks: cim.risks.length ? cim.risks : ["No risks were flagged from the CIM."],
    generatedAt: now.toISOString(),
    model: "claude",
  };
}
