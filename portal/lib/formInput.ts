import { normalizeCim, parseJsonReply } from "./cim";
import type { Acquirer, CapitalType, CimExtraction, SubmissionInput, Timeline, UseOfFunds } from "./types";

function text(fd: FormData, key: string): string {
  return String(fd.get(key) ?? "").trim();
}

/** Accepts "4,500,000", "$4.5M", "750k". */
export function dollars(raw: string): number {
  const match = raw.toLowerCase().replace(/[$,\s]/g, "").match(/^(-?\d*\.?\d+)([km])?$/);
  if (!match) return 0;
  const n = parseFloat(match[1]);
  return Math.round(match[2] === "m" ? n * 1_000_000 : match[2] === "k" ? n * 1_000 : n);
}

const money = (fd: FormData, key: string) => dollars(text(fd, key));
const optionalMoney = (fd: FormData, key: string) => (text(fd, key) ? dollars(text(fd, key)) : null);
const checked = (fd: FormData, key: string) => fd.get(key) === "on";

/** Builds a submission from the apply form. Used by the server action and the browser version alike. */
export function parseSubmission(fd: FormData): SubmissionInput {
  const useOfFunds = text(fd, "useOfFunds") as UseOfFunds;
  const acquisition = useOfFunds === "acquisition";
  const ownsBusiness = acquisition && fd.get("ownsBusiness") === "yes";

  const acquirer: Acquirer | null = acquisition
    ? {
        ownsBusiness,
        current: ownsBusiness
          ? {
              name: text(fd, "curName"),
              website: text(fd, "curWebsite"),
              city: text(fd, "curCity"),
              state: text(fd, "curState"),
              yearFounded: Number(text(fd, "curYearFounded")),
              employees: Number(text(fd, "curEmployees")),
              description: text(fd, "curDescription"),
              revenueLTM: money(fd, "curRevenueLTM"),
              revenuePrior: money(fd, "curRevenuePrior"),
              ebitdaLTM: money(fd, "curEbitdaLTM"),
              existingDebt: money(fd, "curExistingDebt"),
              ownershipPct: Number(text(fd, "curOwnershipPct")),
            }
          : null,
        combine: ownsBusiness && checked(fd, "combine"),
        background: text(fd, "background"),
      }
    : null;

  const cimRaw = text(fd, "cimJson");
  const cimSent = cimRaw ? (parseJsonReply(cimRaw) as Partial<CimExtraction> | null) : null;

  return {
    contact: {
      name: text(fd, "contactName"),
      title: text(fd, "contactTitle"),
      email: text(fd, "contactEmail"),
      phone: text(fd, "contactPhone"),
    },
    company: {
      name: text(fd, "companyName"),
      website: text(fd, "website"),
      city: text(fd, "city"),
      state: text(fd, "state"),
      yearFounded: Number(text(fd, "yearFounded")),
      employees: Number(text(fd, "employees")),
      description: text(fd, "description"),
    },
    ownership: {
      diverseOwned: checked(fd, "diverseOwned"),
      ownerOperator: checked(fd, "ownerOperator"),
    },
    deal: {
      amount: money(fd, "amount"),
      capitalType: text(fd, "capitalType") as CapitalType,
      useOfFunds,
      timeline: text(fd, "timeline") as Timeline,
      details: text(fd, "details"),
      purchasePrice: acquisition ? optionalMoney(fd, "purchasePrice") : null,
      sellerNote: acquisition ? optionalMoney(fd, "sellerNote") : null,
      buyerEquity: acquisition ? optionalMoney(fd, "buyerEquity") : null,
    },
    financials: {
      revenueLTM: money(fd, "revenueLTM"),
      revenuePrior: money(fd, "revenuePrior"),
      ebitdaLTM: money(fd, "ebitdaLTM"),
      topCustomerPct: Number(text(fd, "topCustomerPct")),
      existingDebt: money(fd, "existingDebt"),
    },
    acquirer,
    // Re-normalized here: the browser sent it, so it is untrusted like any other field.
    cim:
      cimSent && typeof cimSent === "object"
        ? normalizeCim(rebuildRaw(cimSent), {
            fileName: typeof cimSent.fileName === "string" ? cimSent.fileName : "CIM.pdf",
            pageCount: typeof cimSent.pageCount === "number" ? cimSent.pageCount : null,
            pagesRead: typeof cimSent.pagesRead === "number" ? cimSent.pagesRead : null,
          })
        : null,
  };
}

/** A CimExtraction sent back from the browser, reshaped into the raw reply shape normalizeCim reads. */
function rebuildRaw(x: Partial<CimExtraction>): Record<string, unknown> {
  const v: Partial<CimExtraction["values"]> = x.values ?? {};
  return {
    company: { name: v.companyName, website: v.website, city: v.city, state: v.state, yearFounded: v.yearFounded, employees: v.employees, description: v.description },
    financials: { revenueLTM: v.revenueLTM, revenuePrior: v.revenuePrior, ebitdaLTM: v.ebitdaLTM, topCustomerPct: v.topCustomerPct, existingDebt: v.existingDebt },
    deal: { askingPrice: v.askingPrice, sellerNote: v.sellerNote, reasonForSale: x.reasonForSale },
    labels: x.labels,
    naics: x.naics,
    sources: x.sources,
    summary: x.summary,
    keyFacts: x.keyFacts,
    risks: x.risks,
    notFound: x.notFound,
  };
}
