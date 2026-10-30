import { CAPITAL_TYPE_LABELS, SECTOR_LABELS, USE_OF_FUNDS_LABELS, lowerFirst, money, multiple } from "./format";
import { isDebtRequest, proFormaLeverage } from "./scoring";
import type { Provider, Submission } from "./types";

/** pass: meets the published rule. fail: breaks it. confirm: not published or can't be checked from the submission. */
export type Outcome = "pass" | "fail" | "confirm";

export interface Criterion {
  label: string;
  outcome: Outcome;
  detail: string;
}

export interface ProviderMatch {
  provider: Provider;
  /** 0 to 100, only meaningful when eligible. */
  score: number;
  strength: "Strong" | "Good" | "Fair";
  /** No requirement fails. Items marked "confirm" still need a call. */
  eligible: boolean;
  toConfirm: Criterion[];
  requirements: Criterion[];
  /** Soft preferences that rank eligible providers. */
  reasons: string[];
}

/** Checks a value against bounds that may be unpublished. */
function bounded(label: string, value: number, min: number | null, max: number | null, what: string): Criterion {
  if (min === null && max === null) return { label, outcome: "confirm", detail: `No ${what} range published` };
  if (min !== null && value < min) return { label, outcome: "fail", detail: `${money(value)} is below their ${money(min)} ${what} minimum` };
  if (max !== null && value > max) return { label, outcome: "fail", detail: `${money(value)} is above their ${money(max)} ${what} maximum` };
  const shown = min !== null && max !== null ? `${money(min)} to ${money(max)}` : min !== null ? `${money(min)} and up` : `up to ${money(max!)}`;
  return { label, outcome: "pass", detail: `${money(value)} fits their ${shown} ${what} range` };
}

export function evaluateProvider(s: Submission, p: Provider, now = new Date()): ProviderMatch {
  const sector = s.naics.sector;
  const sectorName = SECTOR_LABELS[sector] ?? sector;
  const f = s.financials;
  const lev = proFormaLeverage(s);
  const use = s.deal.useOfFunds;
  const useLabel = USE_OF_FUNDS_LABELS[use].toLowerCase();
  const capLabel = lowerFirst(CAPITAL_TYPE_LABELS[s.deal.capitalType]);

  const requirements: Criterion[] = [
    p.capitalTypes.includes(s.deal.capitalType)
      ? { label: "Capital type", outcome: "pass", detail: `Provides ${capLabel}` }
      : { label: "Capital type", outcome: "fail", detail: `Does not provide ${capLabel}` },
    bounded("Check size", s.deal.amount, p.checkMin, p.checkMax, "check size"),
  ];

  if (p.requiresPositiveEbitda && f.ebitdaLTM <= 0) {
    requirements.push({ label: "EBITDA", outcome: "fail", detail: "Requires positive EBITDA" });
  } else if (p.ebitdaMin === null && p.ebitdaMax === null && p.requiresPositiveEbitda) {
    requirements.push({ label: "EBITDA", outcome: "pass", detail: "Positive EBITDA, as required" });
  } else {
    requirements.push(bounded("EBITDA", f.ebitdaLTM, p.ebitdaMin, p.ebitdaMax, "EBITDA"));
  }

  // Revenue and operating history are only checked where a screen is published.
  if (p.revenueMin !== null || p.revenueMax !== null) {
    requirements.push(bounded("Revenue", f.revenueLTM, p.revenueMin, p.revenueMax, "revenue"));
  }
  if (p.minYears !== null) {
    const years = now.getFullYear() - s.company.yearFounded;
    requirements.push(
      years >= p.minYears
        ? { label: "Operating history", outcome: "pass", detail: `${years} years in business (they need ${p.minYears}+)` }
        : { label: "Operating history", outcome: "fail", detail: `${years} years in business; they need ${p.minYears}+` },
    );
  }

  const inArea = p.geographies.includes("National") || p.geographies.includes(s.company.state);
  if (!inArea) {
    requirements.push(
      p.geographiesConfirm.includes(s.company.state)
        ? { label: "Geography", outcome: "confirm", detail: `${s.company.state} may be in their area; core is ${p.geographies.join(", ")}` }
        : { label: "Geography", outcome: "fail", detail: `Covers ${p.geographies.length > 8 ? "listed states" : p.geographies.join(", ")}, not ${s.company.state}` },
    );
  } else if (p.geographyConfirm) {
    requirements.push({ label: "Geography", outcome: "confirm", detail: p.geographyConfirm });
  } else {
    requirements.push({
      label: "Geography",
      outcome: "pass",
      detail: p.geographies.includes("National") ? "Invests nationally" : `Active in ${s.company.state}`,
    });
  }

  requirements.push(
    p.sectorsExcluded.includes(sector)
      ? { label: "Industry", outcome: "fail", detail: `Excludes ${sectorName.toLowerCase()}` }
      : p.sectorsOnly && !p.sectorsPreferred.includes(sector)
        ? { label: "Industry", outcome: "fail", detail: `Only invests in ${p.sectorsPreferred.map((k) => SECTOR_LABELS[k] ?? k).join(", ").toLowerCase()}` }
        : { label: "Industry", outcome: "pass", detail: `${sectorName} is not excluded` },
  );

  requirements.push(
    p.useOfFunds.includes(use)
      ? { label: "Use of funds", outcome: "pass", detail: `Funds ${useLabel}` }
      : p.useOfFundsConfirm.includes(use)
        ? { label: "Use of funds", outcome: "confirm", detail: `${USE_OF_FUNDS_LABELS[use]} not published as an eligible use` }
        : { label: "Use of funds", outcome: "fail", detail: `Does not fund ${useLabel}` },
  );

  const diverse = s.ownership.diverseOwned;
  if (p.ownershipRequirement === "minority") {
    requirements.push(
      diverse
        ? { label: "Ownership", outcome: "pass", detail: "Minority-owned, as required" }
        : { label: "Ownership", outcome: "fail", detail: "Requires a minority-owned business" },
    );
  } else if (p.ownershipRequirement === "minority_or_women") {
    requirements.push(
      diverse
        ? { label: "Ownership", outcome: "pass", detail: "Minority-owned, as required" }
        : { label: "Ownership", outcome: "confirm", detail: "Requires minority or women ownership; qualifies only if women-owned" },
    );
  } else if (p.ownershipRequirement === "specific") {
    const who = p.ownershipLabel ?? "a specific ownership group";
    requirements.push(
      diverse
        ? { label: "Ownership", outcome: "confirm", detail: `Requires ${who.charAt(0).toLowerCase()}${who.slice(1)}` }
        : { label: "Ownership", outcome: "fail", detail: `Requires ${who.charAt(0).toLowerCase()}${who.slice(1)}` },
    );
  }

  if (isDebtRequest(s) && p.maxLeverage !== null) {
    requirements.push({
      label: "Leverage",
      outcome: lev !== null && lev <= p.maxLeverage ? "pass" : "fail",
      detail: lev === null ? "EBITDA is not positive" : `${multiple(lev)} pro forma vs. ${multiple(p.maxLeverage)} max`,
    });
  }

  const eligible = requirements.every((r) => r.outcome !== "fail");
  const toConfirm = requirements.filter((r) => r.outcome === "confirm");

  // Soft preferences: 100 points total.
  let score = 0;
  const reasons: string[] = [];

  if (p.sectorsPreferred.includes(sector)) {
    score += 30;
    reasons.push(`Targets ${sectorName.toLowerCase()}`);
  } else if (p.sectorsPreferred.length === 0) {
    score += 15;
    reasons.push("No sector preference");
  }

  if (p.diverseFocus && diverse) {
    score += 20;
    reasons.push("Mandate to back minority-owned businesses");
  }

  if (p.checkMin !== null && p.checkMax !== null) {
    const position = (s.deal.amount - p.checkMin) / Math.max(p.checkMax - p.checkMin, 1);
    if (position >= 0.15 && position <= 0.85) {
      score += 20;
      reasons.push("Ask sits well inside their check range");
    } else {
      score += 10;
    }
  } else if (p.checkMin !== null || p.checkMax !== null) {
    score += 10;
  } else {
    score += 4;
  }

  if (p.ebitdaMin !== null && f.ebitdaLTM >= 1.5 * p.ebitdaMin) {
    score += 15;
    reasons.push("Comfortable EBITDA cushion over their floor");
  } else if (p.ebitdaMin !== null || p.ebitdaMax !== null) {
    score += 9;
  } else {
    score += 4;
  }

  score += toConfirm.length === 0 ? 15 : toConfirm.length === 1 ? 8 : 0;

  return {
    provider: p,
    score,
    strength: score >= 70 ? "Strong" : score >= 50 ? "Good" : "Fair",
    eligible,
    toConfirm,
    requirements,
    reasons,
  };
}

export interface MatchResult {
  /** Eligible providers: those meeting every published criterion first, then by fewest items to confirm and score. */
  matches: ProviderMatch[];
  /** Eligible providers with nothing left to confirm. */
  confirmed: ProviderMatch[];
  /** Eligible providers with one or more unpublished or unverifiable criteria. */
  possible: ProviderMatch[];
  /** Providers that miss exactly one flexible requirement: worth a look if the deal can be resized or restructured. */
  nearMisses: ProviderMatch[];
}

const FLEXIBLE = ["Check size", "EBITDA", "Revenue"];

export function matchProviders(s: Submission, providers: Provider[]): MatchResult {
  const all = providers.map((p) => evaluateProvider(s, p));
  const matches = all
    .filter((m) => m.eligible)
    .sort((a, b) => Math.min(a.toConfirm.length, 2) - Math.min(b.toConfirm.length, 2) || b.score - a.score);
  return {
    matches,
    confirmed: matches.filter((m) => m.toConfirm.length === 0),
    possible: matches.filter((m) => m.toConfirm.length > 0),
    nearMisses: all
      .filter((m) => {
        const fails = m.requirements.filter((r) => r.outcome === "fail");
        return !m.eligible && fails.length === 1 && FLEXIBLE.includes(fails[0].label);
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 3),
  };
}
