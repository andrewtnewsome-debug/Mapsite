import type { User } from "./types";

// Demo personas. The role switcher in the header stands in for login.
// TODO(auth): replace with real identity provider and session handling.

export const ADMIN_USERS: User[] = [
  {
    id: "u-admin-1",
    name: "Camille Rhodes",
    email: "c.rhodes@nmsdc.example",
    role: "admin",
    firmName: "NMSDC Platform Operations",
    title: "Director, Capital Access Programs",
  },
];

export const INVESTOR_USERS: User[] = [
  {
    id: "u-inv-northgate",
    name: "Raymond Chu",
    email: "rchu@northgateequity.example",
    role: "investor",
    firmName: "Northgate Equity Partners",
    title: "Principal",
  },
  {
    id: "u-inv-harbor",
    name: "Jordan Ellis",
    email: "jordan@harborlanecap.example",
    role: "investor",
    firmName: "Harbor Lane Capital",
    title: "Founder & CEO (Searcher)",
  },
  {
    id: "u-inv-fulcrum",
    name: "Marcus Bell",
    email: "marcus@fulcrumstreet.example",
    role: "investor",
    firmName: "Fulcrum Street Partners",
    title: "Managing Partner",
  },
  {
    id: "u-inv-stonebridge",
    name: "Evelyn Grant",
    email: "egrant@stonebridgefo.example",
    role: "investor",
    firmName: "Stonebridge Family Office",
    title: "Chief Investment Officer",
  },
  {
    id: "u-inv-allied",
    name: "Sarah Whitfield",
    email: "swhitfield@alliedfacility.example",
    role: "investor",
    firmName: "Allied Facility Group",
    title: "VP, Corporate Development",
  },
];

export const OWNER_USERS: User[] = [
  { id: "u-own-1001", name: "Ramon Delgado", email: "rdelgado@gulflineprecision.example", role: "owner", firmName: "Gulfline Precision Components, Inc.", title: "President & Owner" },
  { id: "u-own-1002", name: "Denise Holloway", email: "denise@peachtreefreight.example", role: "owner", firmName: "Peachtree Freight Partners, LLC", title: "Founder & CEO" },
  { id: "u-own-1003", name: "Luis Navarro", email: "luis@saborkitchenfoods.example", role: "owner", firmName: "Sabor Kitchen Foods, LLC", title: "Co-Founder & CEO" },
  { id: "u-own-1004", name: "Gloria Adeyemi", email: "gadeyemi@chesapeakehh.example", role: "owner", firmName: "Chesapeake Home Health Partners, Inc.", title: "Founder & Administrator" },
  { id: "u-own-1005", name: "Priya Raman", email: "praman@meridiandigital.example", role: "owner", firmName: "Meridian Digital Systems, Inc.", title: "Founder & CEO" },
  { id: "u-own-1006", name: "Terrence Wallace", email: "twallace@queencitybuilders.example", role: "owner", firmName: "Queen City Builders Group, LLC", title: "President" },
  { id: "u-own-1007", name: "Maria Castillo", email: "mcastillo@pacificcrestfs.example", role: "owner", firmName: "Pacific Crest Facility Services, Inc.", title: "CEO & Majority Owner" },
  { id: "u-own-1008", name: "Kevin Okafor", email: "kokafor@buckeyeworkforce.example", role: "owner", firmName: "Buckeye Workforce Solutions, LLC", title: "Founder & President" },
  { id: "u-own-1009", name: "Hector Ramirez", email: "hramirez@lakeshorecorrugated.example", role: "owner", firmName: "Lakeshore Corrugated & Display Co.", title: "Chairman & Owner" },
  { id: "u-own-1010", name: "Simone Baptiste", email: "simone@kinfolkbotanicals.example", role: "owner", firmName: "Kinfolk Botanicals, Inc.", title: "Founder & CEO" },
  { id: "u-own-1011", name: "Andre Mitchell", email: "amitchell@firstcoastlogistics.example", role: "owner", firmName: "First Coast Logistics Group, LLC", title: "CEO" },
  { id: "u-own-1012", name: "Daniel Begay", email: "dbegay@sonoranpt.example", role: "owner", firmName: "Sonoran Physical Therapy & Rehab, PLLC", title: "Founder & Clinical Director" },
  { id: "u-own-1013", name: "Nadia Haddad", email: "nhaddad@rocketcitycyber.example", role: "owner", firmName: "Rocket City Cyber Compliance, LLC", title: "Founder & Principal" },
  { id: "u-own-1014", name: "Javier Montoya", email: "jmontoya@frontrangemech.example", role: "owner", firmName: "Front Range Mechanical Services, LLC", title: "Owner & General Manager" },
  { id: "u-own-1015", name: "Celeste Broussard", email: "celeste@crescentroasting.example", role: "owner", firmName: "Crescent Roasting Company, LLC", title: "Founder & Owner" },
];

export const USERS: User[] = [...ADMIN_USERS, ...INVESTOR_USERS, ...OWNER_USERS];

export const DEFAULT_INVESTOR_ID = "u-inv-northgate";
export const DEFAULT_OWNER_ID = "u-own-1007";
export const DEFAULT_ADMIN_ID = "u-admin-1";

export function getUser(id: string | undefined): User | undefined {
  return USERS.find((u) => u.id === id);
}
