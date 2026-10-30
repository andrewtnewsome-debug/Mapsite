import type { NaicsResult } from "./types";

/**
 * PLACEHOLDER for the Claude NAICS classifier. Picks a code by keyword so the
 * prototype shows realistic output; Phase 1 replaces this with a model call.
 */

interface NaicsEntry {
  code: string;
  title: string;
  keywords: string[];
}

const TABLE: NaicsEntry[] = [
  { code: "238220", title: "Plumbing, Heating, and Air-Conditioning Contractors", keywords: ["hvac", "plumbing", "heating", "air-conditioning", "air conditioning", "mechanical contractor"] },
  { code: "238210", title: "Electrical Contractors and Other Wiring Installation Contractors", keywords: ["electrical contractor", "electrician", "wiring"] },
  { code: "236220", title: "Commercial and Institutional Building Construction", keywords: ["general contractor", "commercial construction", "build-out", "tenant improvement"] },
  { code: "561720", title: "Janitorial Services", keywords: ["janitorial", "custodial", "commercial cleaning", "facility services"] },
  { code: "561730", title: "Landscaping Services", keywords: ["landscaping", "landscape", "grounds maintenance", "lawn"] },
  { code: "561612", title: "Security Guards and Patrol Services", keywords: ["security guard", "patrol", "security services"] },
  { code: "484121", title: "General Freight Trucking, Long-Distance, Truckload", keywords: ["trucking", "truckload", "fleet of tractors"] },
  { code: "488510", title: "Freight Transportation Arrangement", keywords: ["freight brokerage", "3pl", "third-party logistics", "logistics", "brokerage"] },
  { code: "621610", title: "Home Health Care Services", keywords: ["home health", "home care", "skilled nursing visits", "caregivers"] },
  { code: "621111", title: "Offices of Physicians (except Mental Health Specialists)", keywords: ["physician practice", "primary care", "medical practice"] },
  { code: "621210", title: "Offices of Dentists", keywords: ["dental", "dentist", "orthodont"] },
  { code: "624410", title: "Child Day Care Services", keywords: ["child care", "childcare", "early learning", "preschool", "daycare"] },
  { code: "611710", title: "Educational Support Services", keywords: ["tutoring", "test prep", "educational support"] },
  { code: "541512", title: "Computer Systems Design Services", keywords: ["managed services", "msp", "it services", "cybersecurity", "systems integration"] },
  { code: "541511", title: "Custom Computer Programming Services", keywords: ["software development", "custom software", "app development"] },
  { code: "541330", title: "Engineering Services", keywords: ["engineering firm", "civil engineering", "engineering services"] },
  { code: "541611", title: "Administrative Management and General Management Consulting Services", keywords: ["management consulting", "consulting firm", "advisory"] },
  { code: "332710", title: "Machine Shops", keywords: ["machining", "machine shop", "cnc", "precision components"] },
  { code: "311812", title: "Commercial Bakeries", keywords: ["bakery", "baked goods", "bread", "pastries"] },
  { code: "424410", title: "General Line Grocery Merchant Wholesalers", keywords: ["food distribution", "grocery wholesale", "foodservice distributor"] },
  { code: "722511", title: "Full-Service Restaurants", keywords: ["full-service restaurant", "dining", "restaurant group"] },
  { code: "722513", title: "Limited-Service Restaurants", keywords: ["quick service", "quick-service", "fast casual", "franchisee"] },
  { code: "811121", title: "Automotive Body, Paint, and Interior Repair and Maintenance", keywords: ["collision", "auto body", "paint and body"] },
  { code: "811111", title: "General Automotive Repair", keywords: ["auto repair", "automotive repair", "mechanic"] },
  { code: "531311", title: "Residential Property Managers", keywords: ["property management", "property manager", "multifamily management"] },
];

const FALLBACK: NaicsEntry = {
  code: "541990",
  title: "All Other Professional, Scientific, and Technical Services",
  keywords: [],
};

export function sectorOf(code: string): string {
  const two = code.slice(0, 2);
  if (["31", "32", "33"].includes(two)) return "31-33";
  if (["44", "45"].includes(two)) return "44-45";
  if (["48", "49"].includes(two)) return "48-49";
  return two;
}

export function classifyNaics(name: string, description: string): NaicsResult {
  const text = `${name} ${description}`.toLowerCase();
  const ranked = TABLE.map((entry) => ({
    entry,
    hits: entry.keywords.filter((k) => text.includes(k)),
  }))
    .filter((r) => r.hits.length > 0)
    .sort((a, b) => b.hits.length - a.hits.length);

  if (ranked.length === 0) {
    return {
      code: FALLBACK.code,
      title: FALLBACK.title,
      sector: sectorOf(FALLBACK.code),
      confidence: 0.41,
      rationale:
        "The description does not clearly indicate a primary product or service line. Defaulting to a general professional services code; recommend confirming with the applicant.",
      alternates: [],
    };
  }

  const best = ranked[0];
  const quoted = best.hits.slice(0, 2).map((h) => `"${h}"`).join(" and ");
  const confidence = Math.min(0.97, 0.78 + best.hits.length * 0.07);
  return {
    code: best.entry.code,
    title: best.entry.title,
    sector: sectorOf(best.entry.code),
    confidence,
    rationale: `The business description references ${quoted}, which indicates the company's primary revenue comes from activity classified under ${best.entry.code} (${best.entry.title}).`,
    alternates: ranked.slice(1, 3).map((r) => ({ code: r.entry.code, title: r.entry.title })),
  };
}
