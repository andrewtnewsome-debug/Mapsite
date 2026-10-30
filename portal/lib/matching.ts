import { CAPITAL_TYPE_LABELS, SECTOR_LABELS, USE_OF_FUNDS_LABELS, money, multiple } from "./format";
import { isDebtRequest, proFormaLeverage } from "./scoring";
import type { Provider, Submission } from "./types";

export interface Criterion {
  label: string;
  passed: boolean;
  detail: string;
}

export interface ProviderMatch {
  provider: Provider;
  /** 0 to 100, only meaningful when eligible. */
  score: number;
  strength: "Excellent" | "Good" | "Possible";
  eligible: boolean;
  /** Hard requirements: every one must pass for the provider to be a match. */
  requirements: Criterion[];
  /** Soft preferences that rank eligible providers. */
  reasons: string[];
}

export function evaluateProvider(s: Submission, p: Provider): ProviderMatch {
  const sector = s.naics.sector;
  const sectorName = SECTOR_LABELS[sector] ?? sector;
  const lev = proFormaLeverage(s);
  const debt = isDebtRequest(s);

  const requirements: Criterion[] = [
    {
      label: "Capital type",
      passed: p.capitalTypes.includes(s.deal.capitalType),
      detail: p.capitalTypes.includes(s.deal.capitalType)
        ? `Provides ${CAPITAL_TYPE_LABELS[s.deal.capitalType].toLowerCase()}`
        : `Does not provide ${CAPITAL_TYPE_LABELS[s.deal.capitalType].toLowerCase()}`,
    },
    {
      label: "Check size",
      passed: s.deal.amount >= p.checkMin && s.deal.amount <= p.checkMax,
      detail:
        s.deal.amount < p.checkMin
          ? `${money(s.deal.amount)} is below their ${money(p.checkMin)} minimum`
          : s.deal.amount > p.checkMax
            ? `${money(s.deal.amount)} is above their ${money(p.checkMax)} maximum`
            : `${money(s.deal.amount)} fits their ${money(p.checkMin)} to ${money(p.checkMax)} range`,
    },
    {
      label: "Minimum EBITDA",
      passed: s.financials.ebitdaLTM >= p.minEbitda,
      detail: `${money(s.financials.ebitdaLTM)} vs. ${money(p.minEbitda)} minimum`,
    },
    {
      label: "Minimum revenue",
      passed: s.financials.revenueLTM >= p.minRevenue,
      detail: `${money(s.financials.revenueLTM)} vs. ${money(p.minRevenue)} minimum`,
    },
    {
      label: "Geography",
      passed: p.geographies.includes("National") || p.geographies.includes(s.company.state),
      detail: p.geographies.includes("National")
        ? "Lends / invests nationally"
        : p.geographies.includes(s.company.state)
          ? `Active in ${s.company.state}`
          : `Covers ${p.geographies.join(", ")} only`,
    },
    {
      label: "Industry",
      passed: !p.sectorsExcluded.includes(sector) && (!p.sectorsOnly || p.sectorsPreferred.includes(sector)),
      detail: p.sectorsExcluded.includes(sector)
        ? `Excludes ${sectorName.toLowerCase()}`
        : p.sectorsOnly && !p.sectorsPreferred.includes(sector)
          ? `Only invests in ${p.sectorsPreferred.map((k) => SECTOR_LABELS[k] ?? k).join(", ").toLowerCase()}`
          : `${sectorName} is in scope`,
    },
    {
      label: "Use of funds",
      passed: p.useOfFunds.includes(s.deal.useOfFunds),
      detail: p.useOfFunds.includes(s.deal.useOfFunds)
        ? `Funds ${USE_OF_FUNDS_LABELS[s.deal.useOfFunds].toLowerCase()}`
        : `Does not fund ${USE_OF_FUNDS_LABELS[s.deal.useOfFunds].toLowerCase()}`,
    },
  ];

  if (debt && p.maxLeverage !== null) {
    requirements.push({
      label: "Leverage",
      passed: lev !== null && lev <= p.maxLeverage,
      detail:
        lev === null
          ? "EBITDA is not positive"
          : `${multiple(lev)} pro forma vs. ${multiple(p.maxLeverage)} max`,
    });
  }

  const eligible = requirements.every((r) => r.passed);

  // Soft preferences: 100 points total.
  let score = 0;
  const reasons: string[] = [];

  if (p.sectorsPreferred.includes(sector)) {
    score += 35;
    reasons.push(`Targets ${sectorName.toLowerCase()}`);
  } else if (p.sectorsPreferred.length === 0) {
    score += 18;
    reasons.push("Industry agnostic");
  }

  if (p.diverseFocus && s.ownership.diverseOwned) {
    score += 20;
    reasons.push("Mandate to back minority-owned businesses");
  }

  const span = p.checkMax - p.checkMin;
  const position = span > 0 ? (s.deal.amount - p.checkMin) / span : 0.5;
  if (position >= 0.2 && position <= 0.8) {
    score += 20;
    reasons.push("Ask is in the middle of their check range");
  } else {
    score += 10;
  }

  if (p.minEbitda === 0 || s.financials.ebitdaLTM >= 2 * p.minEbitda) {
    score += 15;
    reasons.push("Comfortable EBITDA cushion over their minimum");
  } else {
    score += 7;
  }

  if (debt && p.maxLeverage !== null && lev !== null) {
    if (p.maxLeverage - lev >= 1) {
      score += 10;
      reasons.push(`A full turn or more of leverage headroom`);
    } else {
      score += 4;
    }
  } else {
    score += 10;
  }

  return {
    provider: p,
    score,
    strength: score >= 75 ? "Excellent" : score >= 55 ? "Good" : "Possible",
    eligible,
    requirements,
    reasons,
  };
}

export interface MatchResult {
  matches: ProviderMatch[];
  /** Providers that miss exactly one flexible requirement: worth a look if the deal can be resized or restructured. */
  nearMisses: ProviderMatch[];
}

const FLEXIBLE = ["Check size", "Minimum EBITDA", "Minimum revenue", "Leverage"];

export function matchProviders(s: Submission, providers: Provider[]): MatchResult {
  const all = providers.map((p) => evaluateProvider(s, p));
  return {
    matches: all.filter((m) => m.eligible).sort((a, b) => b.score - a.score),
    nearMisses: all
      .filter((m) => {
        const misses = m.requirements.filter((r) => !r.passed);
        return !m.eligible && misses.length === 1 && FLEXIBLE.includes(misses[0].label);
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 3),
  };
}
