/**
 * Fictional demo company. Every name here is invented for demonstration.
 * Email addresses use the reserved ".example" domain so nothing can be sent to them.
 */

export const DEMO_COMPANY_ID = "demo-alder-creek";

export const DEMO_COMPANY_PROFILE = {
  id: DEMO_COMPANY_ID,
  name: "Alder Creek Facility Services",
  legalName: "Alder Creek Facility Services, Inc. (fictional)",
  industry: "Commercial facilities services: janitorial, HVAC maintenance and repair projects",
  currency: "USD",
  fiscalYearStartMonth: 1,
} as const;

export interface DemoCustomerProfile {
  id: string;
  name: string;
  email: string;
  /** Share of recurring contract revenue. Shares sum to 1. */
  contractShare: number;
  /** Relative weight when assigning project work. */
  projectWeight: number;
  termsDays: number;
  /** Typical days from invoice date to payment. */
  avgDaysToPay: number;
  paySpreadDays: number;
  /** Pays roughly half up front and the rest later. */
  partialPayer?: boolean;
  /** Average days-to-pay for invoices issued in the most recent months (deteriorating payer). */
  recentSlowdown?: { lastMonths: number; avgDaysToPay: number };
}

export const DEMO_CUSTOMERS: DemoCustomerProfile[] = [
  { id: "C-1001", name: "Granite Peak Properties", email: "ap@granitepeak-properties.example", contractShare: 0.18, projectWeight: 3, termsDays: 30, avgDaysToPay: 41, paySpreadDays: 4, recentSlowdown: { lastMonths: 5, avgDaysToPay: 86 } },
  { id: "C-1002", name: "Cobalt Ridge Medical Group", email: "payables@cobaltridge-medical.example", contractShare: 0.11, projectWeight: 2, termsDays: 30, avgDaysToPay: 27, paySpreadDays: 3 },
  { id: "C-1003", name: "Lakeshore Distribution Center", email: "accounts@lakeshore-dc.example", contractShare: 0.09, projectWeight: 2, termsDays: 45, avgDaysToPay: 49, paySpreadDays: 5 },
  { id: "C-1004", name: "Meridian Tech Campus", email: "finance@meridian-campus.example", contractShare: 0.08, projectWeight: 2, termsDays: 30, avgDaysToPay: 24, paySpreadDays: 3 },
  { id: "C-1005", name: "Harbor Point Hospitality", email: "ap@harborpoint-hospitality.example", contractShare: 0.07, projectWeight: 1.5, termsDays: 30, avgDaysToPay: 34, paySpreadDays: 4 },
  { id: "C-1006", name: "Pinecrest Senior Living", email: "billing@pinecrest-living.example", contractShare: 0.07, projectWeight: 1, termsDays: 30, avgDaysToPay: 44, paySpreadDays: 4, partialPayer: true },
  { id: "C-1007", name: "Redstone Valley Schools", email: "accountspayable@redstone-schools.example", contractShare: 0.06, projectWeight: 1.5, termsDays: 45, avgDaysToPay: 53, paySpreadDays: 6 },
  { id: "C-1008", name: "Ironwood Manufacturing", email: "ap@ironwood-mfg.example", contractShare: 0.06, projectWeight: 2, termsDays: 30, avgDaysToPay: 36, paySpreadDays: 5 },
  { id: "C-1009", name: "Summit Commerce Center", email: "ap@summit-commerce.example", contractShare: 0.05, projectWeight: 1, termsDays: 30, avgDaysToPay: 31, paySpreadDays: 3 },
  { id: "C-1010", name: "Bluewater Credit Union", email: "vendors@bluewater-cu.example", contractShare: 0.04, projectWeight: 0.5, termsDays: 15, avgDaysToPay: 17, paySpreadDays: 2 },
  { id: "C-1011", name: "Copperline Retail Group", email: "ap@copperline-retail.example", contractShare: 0.04, projectWeight: 1, termsDays: 30, avgDaysToPay: 39, paySpreadDays: 5 },
  { id: "C-1012", name: "Aspen Grove Office Park", email: "management@aspengrove-office.example", contractShare: 0.04, projectWeight: 0.8, termsDays: 30, avgDaysToPay: 29, paySpreadDays: 3 },
  { id: "C-1013", name: "Northgate Logistics", email: "payables@northgate-logistics.example", contractShare: 0.03, projectWeight: 0.8, termsDays: 30, avgDaysToPay: 118, paySpreadDays: 8 },
  { id: "C-1014", name: "Westbrook Fitness Clubs", email: "accounting@westbrook-fitness.example", contractShare: 0.03, projectWeight: 0.6, termsDays: 30, avgDaysToPay: 44, paySpreadDays: 5, partialPayer: true },
  { id: "C-1015", name: "Clearview Business Park", email: "ap@clearview-bp.example", contractShare: 0.03, projectWeight: 0.6, termsDays: 30, avgDaysToPay: 30, paySpreadDays: 3 },
  { id: "C-1016", name: "Silver Maple Dental Partners", email: "office@silvermaple-dental.example", contractShare: 0.02, projectWeight: 0.4, termsDays: 15, avgDaysToPay: 19, paySpreadDays: 2 },
];

export interface DemoVendorProfile {
  id: string;
  name: string;
  category: "Materials & Supplies" | "Subcontractors" | "Professional Fees" | "Equipment Rental";
  /** Share of the category spend. */
  share: number;
  termsDays: number;
  avgDaysToPay: number;
  /** Days of the month bills are dated. */
  billDays: number[];
}

export const DEMO_VENDORS: DemoVendorProfile[] = [
  { id: "V-2001", name: "Front Range Janitorial Supply", category: "Materials & Supplies", share: 0.55, termsDays: 30, avgDaysToPay: 29, billDays: [5, 19] },
  { id: "V-2002", name: "Pioneer HVAC Parts Co.", category: "Materials & Supplies", share: 0.45, termsDays: 30, avgDaysToPay: 31, billDays: [8, 22] },
  { id: "V-2003", name: "Cascade Mechanical Contractors", category: "Subcontractors", share: 0.5, termsDays: 45, avgDaysToPay: 44, billDays: [25] },
  { id: "V-2004", name: "Elevation Window Cleaning LLC", category: "Subcontractors", share: 0.3, termsDays: 30, avgDaysToPay: 30, billDays: [24] },
  { id: "V-2005", name: "TrueLine Electrical Services", category: "Subcontractors", share: 0.2, termsDays: 30, avgDaysToPay: 32, billDays: [20] },
  { id: "V-2006", name: "Hollis & Greer CPAs", category: "Professional Fees", share: 0.72, termsDays: 30, avgDaysToPay: 28, billDays: [10] },
  { id: "V-2007", name: "Marlow Legal Group", category: "Professional Fees", share: 0.28, termsDays: 30, avgDaysToPay: 30, billDays: [15] },
  { id: "V-2008", name: "Rampart Equipment Rentals", category: "Equipment Rental", share: 1, termsDays: 30, avgDaysToPay: 30, billDays: [12] },
];

export const CONTRACT_SERVICE_LINES = [
  { name: "Janitorial services", description: "Recurring janitorial services", share: 0.62 },
  { name: "Preventive HVAC maintenance", description: "Scheduled HVAC preventive maintenance visits", share: 0.38 },
];

export const PROJECT_TYPES = [
  "Rooftop unit compressor replacement",
  "Carpet extraction and floor refinishing",
  "Emergency plumbing repair",
  "LED lighting retrofit",
  "Post-construction cleanup",
  "Chiller tune-up and coil cleaning",
  "Parking structure power washing",
  "Boiler inspection and repair",
  "Ductwork cleaning",
  "Window and facade cleaning",
];
