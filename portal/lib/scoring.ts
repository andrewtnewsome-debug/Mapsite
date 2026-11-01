import { DEBT_TYPES, growth, margin, money, multiple, pct } from "./format";
import type { Submission } from "./types";

export interface FitFactor {
  key: string;
  label: string;
  points: number;
  max: number;
  detail: string;
}

export interface FitScore {
  total: number;
  tier: "Strong" | "Moderate" | "Low";
  factors: FitFactor[];
  basis: Underwriting;
}

/** The figures a capital provider underwrites. */
export interface Underwriting {
  revenueLTM: number;
  revenuePrior: number;
  ebitdaLTM: number;
  existingDebt: number;
  /** "combined": an add-on acquisition, judged on the buyer's business plus the target. */
  basis: "single" | "combined";
  /** Short phrase for the UI, e.g. "combined with Crescent HVAC & Plumbing". */
  label: string;
}

export function underwriting(s: Pick<Submission, "financials" | "acquirer" | "deal">): Underwriting {
  const f = s.financials;
  const a = s.acquirer;
  if (a?.ownsBusiness && a.combine && a.current) {
    const c = a.current;
    return {
      revenueLTM: f.revenueLTM + c.revenueLTM,
      revenuePrior: f.revenuePrior + c.revenuePrior,
      ebitdaLTM: f.ebitdaLTM + c.ebitdaLTM,
      existingDebt: f.existingDebt + c.existingDebt,
      basis: "combined",
      label: `combined with ${c.name}`,
    };
  }
  return {
    revenueLTM: f.revenueLTM,
    revenuePrior: f.revenuePrior,
    ebitdaLTM: f.ebitdaLTM,
    existingDebt: f.existingDebt,
    basis: "single",
    label: s.deal.useOfFunds === "acquisition" ? "the business being acquired" : "the company",
  };
}

/** Points for the first threshold the value meets (thresholds in descending order). */
function band(value: number, bands: [number, number][], floor = 0): number {
  for (const [min, points] of bands) if (value >= min) return points;
  return floor;
}

export function isDebtRequest(s: Submission): boolean {
  return DEBT_TYPES.includes(s.deal.capitalType);
}

/** Total debt / EBITDA after this raise. A refinance replaces existing debt rather than adding to it. */
export function proFormaLeverage(s: Submission): number | null {
  const u = underwriting(s);
  if (u.ebitdaLTM <= 0) return null;
  const debt = s.deal.useOfFunds === "refinance" ? Math.max(s.deal.amount, u.existingDebt) : u.existingDebt + s.deal.amount;
  return debt / u.ebitdaLTM;
}

export function scoreSubmission(s: Submission, now = new Date()): FitScore {
  const u = underwriting(s);
  const { revenueLTM, revenuePrior, ebitdaLTM } = u;
  // Concentration is the target's own: the buyer's customer mix isn't asked.
  const { topCustomerPct } = s.financials;
  const factors: FitFactor[] = [];
  const both = u.basis === "combined" ? " combined" : "";

  factors.push({
    key: "scale",
    label: "Scale (LTM EBITDA)",
    max: 25,
    points: band(ebitdaLTM, [
      [3_000_000, 25],
      [1_000_000, 20],
      [500_000, 13],
      [250_000, 7],
      [1, 2],
    ]),
    detail: `${money(ebitdaLTM)}${both} EBITDA. Sweet spot is $1M+.`,
  });

  const m = margin(revenueLTM, ebitdaLTM);
  factors.push({
    key: "margin",
    label: "Profitability (EBITDA margin)",
    max: 15,
    points: band(m, [
      [20, 15],
      [12, 11],
      [7, 7],
      [0.01, 3],
    ]),
    detail: `${pct(m, 1)} margin on ${money(revenueLTM)}${both} revenue.`,
  });

  const g = growth(revenueLTM, revenuePrior);
  factors.push({
    key: "growth",
    label: "Revenue growth (YoY)",
    max: 15,
    points:
      g === null
        ? 4
        : band(g, [
            [20, 15],
            [10, 12],
            [3, 8],
            [-3, 4],
          ]),
    detail: g === null ? "No prior-year revenue provided." : `${g >= 0 ? "+" : ""}${pct(g, 1)} vs. prior year.`,
  });

  const years = now.getFullYear() - s.company.yearFounded;
  factors.push({
    key: "durability",
    label: "Operating history",
    max: 10,
    points: band(years, [
      [15, 10],
      [8, 8],
      [4, 5],
    ], 2),
    detail: `${years} years in business (founded ${s.company.yearFounded}).`,
  });

  factors.push({
    key: "concentration",
    label: "Customer concentration",
    max: 10,
    points: topCustomerPct <= 10 ? 10 : topCustomerPct <= 20 ? 7 : topCustomerPct <= 35 ? 4 : 0,
    detail: `Largest customer is ${pct(topCustomerPct)} of revenue.`,
  });

  if (isDebtRequest(s)) {
    const lev = proFormaLeverage(s);
    factors.push({
      key: "structure",
      label: "Pro forma leverage",
      max: 15,
      points:
        lev === null
          ? 0
          : lev <= 2.5
            ? 15
            : lev <= 3.5
              ? 11
              : lev <= 4.5
                ? 6
                : 1,
      detail:
        lev === null
          ? "EBITDA is not positive, so debt cannot be sized on cash flow."
          : `${multiple(lev)} total debt / EBITDA after the raise. Lenders generally cap at 3.0x to 4.5x.`,
    });
  } else {
    const ratio = ebitdaLTM > 0 ? s.deal.amount / ebitdaLTM : Infinity;
    factors.push({
      key: "structure",
      label: "Ask relative to cash flow",
      max: 15,
      points: ratio <= 5 ? 15 : ratio <= 8 ? 10 : 4,
      detail: Number.isFinite(ratio)
        ? `Equity ask is ${multiple(ratio)} LTM EBITDA.`
        : "EBITDA is not positive.",
    });
  }

  factors.push({
    key: "mission",
    label: "Mission alignment",
    max: 10,
    points: (s.ownership.diverseOwned ? 7 : 0) + (s.ownership.ownerOperator ? 3 : 0),
    detail:
      [
        s.ownership.diverseOwned ? "Minority-owned (51%+)" : "Not minority-owned",
        s.ownership.ownerOperator ? "owner-operated" : "not owner-operated",
      ].join(", ") + ".",
  });

  const total = factors.reduce((sum, f) => sum + f.points, 0);
  return { total, tier: total >= 75 ? "Strong" : total >= 55 ? "Moderate" : "Low", factors, basis: u };
}
