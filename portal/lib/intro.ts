import { defaultCodeName, leaksIdentity, regionOf, scrub } from "./anonymize";
import { CAPITAL_TYPE_LABELS, growth, lowerFirst, margin, money, pct } from "./format";
import type { ProviderMatch } from "./matching";
import { industryOf, noDash } from "./onepager";
import { isDebtRequest, proFormaLeverage, underwriting } from "./scoring";
import type { Submission } from "./types";

/**
 * Anonymized intro emails to a matched capital provider. Built only from structured facts
 * (industry, region, figures), never the company's own words, so nothing names the business.
 */

export interface IntroEmail {
  to: string[];
  subject: string;
  body: string;
}

/** What to ask a provider about each criterion we couldn't confirm from public information. */
const CONFIRM_ASKS: Record<string, string> = {
  "Check size": "your typical check size",
  EBITDA: "the EBITDA range you look for",
  Revenue: "your revenue requirements",
  Geography: "whether you cover the region",
  "Use of funds": "whether you finance this use of proceeds",
  Ownership: "your ownership eligibility requirements",
};

function list(items: string[]): string {
  return items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** Turns match reasons into the lender's terms; internal-only reasons are dropped. */
function reasonFor(reason: string, s: Submission): string | null {
  const target = reason.match(/^Targets (.+)$/i);
  if (target) return `you invest in ${target[1]}`;
  if (/mandate/i.test(reason)) return `${s.deal.useOfFunds === "acquisition" ? "the business will be" : "the company is"} minority-owned, which fits your mandate`;
  if (/check range/i.test(reason)) return "the ask sits well within your check size range";
  return null;
}

export function draftIntroEmail(s: Submission, m: ProviderMatch, opts: { onePagerAttached: boolean }): IntroEmail {
  const p = m.provider;
  const code = defaultCodeName(s);
  const f = s.financials;
  const u = underwriting(s);
  const region = regionOf(s.company.state);
  const acq = s.deal.useOfFunds === "acquisition";
  const years = new Date().getFullYear() - s.company.yearFounded;
  const capital = lowerFirst(CAPITAL_TYPE_LABELS[s.deal.capitalType]);
  const ebitdaLabel = s.cim?.labels.ebitdaLTM?.replace(/,.*$/, "") ?? "EBITDA";
  const g = growth(f.revenueLTM, f.revenuePrior);

  const industry = industryOf(s);
  const providerName = p.name.split(" / ")[0];
  const subject = `${code}: ${money(s.deal.amount)} ${capital} for a ${industry} ${acq ? "acquisition" : "business"} in the ${region}`;

  const why = m.reasons.map((r) => reasonFor(r, s)).filter((r): r is string => !!r).slice(0, 3);
  const checkFits = m.requirements.some((r) => r.label === "Check size" && r.outcome === "pass");
  if (checkFits && !why.some((w) => w.includes("check size"))) why.push("the ask is within your check size range");
  const fitLine = why.length
    ? `Based on your published criteria it looks like a fit for ${providerName}: ${list(why)}.`
    : `Based on your published criteria it looks like a fit for ${providerName}.`;

  const snapshot: string[] = [
    `Business: ${years}-year-old ${industry} company in the ${region}, about ${Math.max(5, Math.round(s.company.employees / 5) * 5)} employees`,
    `LTM revenue of ${money(f.revenueLTM)}${g !== null ? ` (${g >= 0 ? "+" : ""}${pct(g, 1)} year over year)` : ""} and ${ebitdaLabel} of ${money(f.ebitdaLTM)} (${pct(margin(f.revenueLTM, f.ebitdaLTM), 1)} margin)`,
  ];
  if (acq) {
    const price = s.deal.purchasePrice ? ` at ${money(s.deal.purchasePrice)} (${(s.deal.purchasePrice / Math.max(f.ebitdaLTM, 1)).toFixed(1)}x ${ebitdaLabel})` : "";
    const support = [
      s.deal.sellerNote ? `a ${money(s.deal.sellerNote)} seller note` : "",
      s.deal.buyerEquity ? `${money(s.deal.buyerEquity)} of buyer equity` : "",
    ].filter(Boolean);
    snapshot.push(`The ask: ${money(s.deal.amount)} of ${capital} to fund an acquisition${price}${support.length ? `, alongside ${list(support)}` : ""}`);
    const a = s.acquirer;
    snapshot.push(
      a?.ownsBusiness && a.current
        ? `Buyer: owns an established business (${money(a.current.revenueLTM)} revenue)${a.combine ? `; combined the two have ${money(u.revenueLTM)} of revenue and ${money(u.ebitdaLTM)} of EBITDA` : ""}`
        : "Buyer: a first-time acquirer",
    );
  } else {
    snapshot.push(`The ask: ${money(s.deal.amount)} of ${capital} for ${s.deal.useOfFunds.replace("_", " ")}`);
  }
  if (isDebtRequest(s)) {
    const lev = proFormaLeverage(s);
    if (lev !== null) snapshot.push(`Pro forma leverage: ${lev.toFixed(1)}x total debt to ${u.basis === "combined" ? "combined " : ""}EBITDA`);
  }
  if (f.topCustomerPct > 0) snapshot.push(`Largest customer: ${pct(f.topCustomerPct)} of revenue`);
  if (s.ownership.diverseOwned) snapshot.push(acq ? "Ownership: minority-owned after closing" : "Ownership: minority-owned");

  const asks = m.toConfirm.map((c) => CONFIRM_ASKS[c.label]).filter(Boolean);
  const greeting = p.contact?.name ? `Hi ${p.contact.name.split(/\s+/)[0]},` : `Hello ${providerName} team,`;

  const body = [
    greeting,
    "",
    `I'm reaching out from MAP Lab Center about a ${capital} opportunity we're working on, which we're calling ${code}. ${fitLine}`,
    "",
    `${code} at a glance:`,
    ...snapshot.map((line) => `- ${line}`),
    "",
    opts.onePagerAttached ? "A one-page blind teaser is attached." : null,
    opts.onePagerAttached && asks.length ? "" : null,
    asks.length ? `Your public materials didn't cover everything we look at, so could you confirm ${list(asks)}?` : null,
    "",
    `If this fits, we'd be glad to share more detail under NDA and set up a call with the ${acq ? "buyer" : "management team"}.`,
    "",
    "Best regards,",
    "[Your name]",
    "MAP Lab Center",
  ]
    .filter((l) => l !== null)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");

  // Belt and braces: structured facts shouldn't carry names, but scrub anything that slipped in.
  const safe = (t: string) => noDash(leaksIdentity(t, s) ? scrub(t, s) : t);
  return { to: p.contact?.email ? [p.contact.email] : [], subject: safe(subject), body: safe(body) };
}
