import type { Submission } from "./types";

/** Hiding a company's identity for blind teasers and intro emails. */

const REGIONS: [string, string[]][] = [
  ["New England", ["CT", "ME", "MA", "NH", "RI", "VT"]],
  ["Mid-Atlantic", ["NJ", "NY", "PA", "DE", "MD", "DC", "VA", "WV"]],
  ["Southeast", ["NC", "SC", "GA", "FL", "KY", "TN", "AL", "MS"]],
  ["Midwest", ["OH", "IN", "IL", "MI", "WI", "MN", "IA", "MO", "ND", "SD", "NE", "KS"]],
  ["South Central", ["TX", "OK", "AR", "LA"]],
  ["Southwest", ["AZ", "NM"]],
  ["Mountain West", ["CO", "UT", "NV", "ID", "MT", "WY"]],
  ["West Coast", ["CA", "OR", "WA", "AK", "HI"]],
];

const STATE_NAMES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware",
  DC: "District of Columbia", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa",
  KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota",
  MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey",
  NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon",
  PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah",
  VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
};

export function regionOf(state: string): string {
  return REGIONS.find(([, states]) => states.includes(state))?.[0] ?? "United States";
}

// Words unlikely to collide with real company or provider names in the pipeline.
const CODE_WORDS = ["Atlas", "Beacon", "Cedar", "Ember", "Falcon", "Granite", "Juniper", "Lantern", "Orion", "Quarry", "Redwood", "Sierra", "Vantage", "Willow", "Aspen", "Cobalt"];

/** The deal's code name: the one already saved, a "Project X" name the deal came with, or one derived from its id. */
export function defaultCodeName(s: Pick<Submission, "id" | "company" | "onePager">): string {
  if (s.onePager?.codeName) return s.onePager.codeName;
  const own = s.company.name.match(/\bProject\s+\w+/i)?.[0];
  if (own) return own.replace(/^project/i, "Project");
  let h = 0;
  for (const ch of s.id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return `Project ${CODE_WORDS[h % CODE_WORDS.length]}`;
}

const SUFFIX = /,?\s+(llc|l\.l\.c\.|inc\.?|incorporated|co\.?|company|corp\.?|corporation|ltd\.?|group|holdings)$/i;
const COMMON = new Set(["the", "and", "services", "service", "group", "company", "solutions", "systems", "partners", "home", "health", "commercial", "american", "national", "first"]);

/** Strings that would identify the company, longest first. */
function identifiers(s: Submission): string[] {
  const names = [s.company.name, s.acquirer?.current?.name ?? "", s.cim?.values.companyName ?? ""].filter(Boolean);
  const out = new Set<string>();
  for (const n of names) {
    out.add(n);
    const bare = n.replace(/\s*\(.*?\)\s*/g, " ").replace(SUFFIX, "").trim();
    out.add(bare);
    // A distinctive first word ("Harbor" in "Harbor Point Landscape") often stands alone in CIM text.
    const first = bare.split(/\s+/)[0];
    if (first && first.length >= 4 && !COMMON.has(first.toLowerCase())) out.add(first);
  }
  for (const w of [s.company.website, s.acquirer?.current?.website ?? "", s.cim?.values.website ?? ""]) if (w) out.add(w.replace(/^https?:\/\//, "").replace(/^www\./, ""));
  return [...out].filter((x) => x.trim().length >= 3).sort((a, b) => b.length - a.length);
}

/** The contact's full name and surname. */
function people(s: Submission): string[] {
  const parts = s.contact.name.trim().split(/\s+/).filter((p) => p.length >= 3);
  return [s.contact.name.trim(), ...parts.slice(-1)].filter((x) => x.length >= 3);
}

const escape = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Replaces names, websites and the city with neutral words. */
export function scrub(text: string, s: Submission): string {
  let out = text;
  for (const id of identifiers(s)) out = out.replace(new RegExp(`\\b${escape(id)}(['’]s)?\\b`, "gi"), (_m, poss) => (poss ? "the Company's" : "the Company"));
  for (const person of people(s)) out = out.replace(new RegExp(`\\b${escape(person)}\\b`, "g"), "the owner");
  for (const place of [s.company.city, s.acquirer?.current?.city ?? ""].filter((c) => c.length >= 3)) {
    out = out.replace(new RegExp(`\\b${escape(place)}(,\\s*[A-Z]{2}\\b)?`, "g"), `the ${regionOf(s.company.state)}`);
  }
  const region = regionOf(s.company.state);
  // Counties and the state itself narrow the location down too far for a blind teaser.
  out = out
    .replace(/\b(?:[A-Z][a-z]+\s){1,2}(?:County|Parish)(?:,\s*[A-Z]{2}\b)?/g, `the ${region}`)
    .replace(new RegExp(`\\b${escape(STATE_NAMES[s.company.state] ?? "@@")}\\b`, "g"), `the ${region}`)
    .replace(new RegExp(`,\\s*${s.company.state}\\b`, "g"), "")
    .replace(/\b(the|The) the\b/g, "$1");
  return out.replace(/\bthe Company the Company\b/g, "the Company").replace(/(^|[.!?]\s+)the Company/g, (_m, p) => `${p}The Company`);
}

/** True when any identifier still appears in the text. */
export function leaksIdentity(text: string, s: Submission): boolean {
  return [...identifiers(s), ...people(s)].some((id) => new RegExp(`\\b${escape(id)}\\b`, "i").test(text));
}
