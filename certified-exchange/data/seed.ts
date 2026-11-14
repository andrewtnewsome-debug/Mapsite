import type { ActivityEvent, DealFilters, Inquiry, Message, NDA, SavedDeal, SavedSearch } from "./types";
import { brand } from "@/config/brand";

// Seeded platform activity so the demo opens with a realistic level of engagement.
// The default investor persona (Northgate Equity Partners) starts with no NDAs so the
// full pursue -> sign -> unlock -> inquire story can be run from a clean slate.

export const threadId = (dealId: string, investorUserId: string) => `${dealId}__${investorUserId}`;

export const SEED_NDAS: NDA[] = [
  { id: "nda-5001", dealId: "d-1004", investorUserId: "u-inv-harbor", signedName: "Jordan Ellis", signedTitle: "Founder & CEO", firmName: "Harbor Lane Capital", signedAt: "2026-09-12T15:22:00.000Z", version: brand.ndaVersion },
  { id: "nda-5002", dealId: "d-1001", investorUserId: "u-inv-fulcrum", signedName: "Marcus Bell", signedTitle: "Managing Partner", firmName: "Fulcrum Street Partners", signedAt: "2026-10-09T18:05:00.000Z", version: brand.ndaVersion },
  { id: "nda-5003", dealId: "d-1007", investorUserId: "u-inv-allied", signedName: "Sarah Whitfield", signedTitle: "VP, Corporate Development", firmName: "Allied Facility Group", signedAt: "2026-10-20T16:40:00.000Z", version: brand.ndaVersion },
  { id: "nda-5004", dealId: "d-1003", investorUserId: "u-inv-stonebridge", signedName: "Evelyn Grant", signedTitle: "Chief Investment Officer", firmName: "Stonebridge Family Office", signedAt: "2026-10-25T14:12:00.000Z", version: brand.ndaVersion },
  { id: "nda-5005", dealId: "d-1007", investorUserId: "u-inv-stonebridge", signedName: "Evelyn Grant", signedTitle: "Chief Investment Officer", firmName: "Stonebridge Family Office", signedAt: "2026-10-29T13:31:00.000Z", version: brand.ndaVersion },
  { id: "nda-5006", dealId: "d-1010", investorUserId: "u-inv-stonebridge", signedName: "Evelyn Grant", signedTitle: "Chief Investment Officer", firmName: "Stonebridge Family Office", signedAt: "2026-11-08T15:48:00.000Z", version: brand.ndaVersion },
];

export const SEED_INQUIRIES: Inquiry[] = [
  {
    id: "inq-6001",
    dealId: "d-1004",
    investorUserId: "u-inv-harbor",
    message:
      "Thank you for sharing the CIM. Home health is one of our two priority sectors, and we would value a call to understand how referral relationships are managed day to day and how you see the clinical team evolving after a transition.",
    criteriaFit: "Strong fit: within all stated investment criteria",
    capitalAvailable: "Committed investors; deal-by-deal approval",
    timeline: "IOI within 30 days",
    createdAt: "2026-09-14T14:10:00.000Z",
  },
  {
    id: "inq-6002",
    dealId: "d-1007",
    investorUserId: "u-inv-allied",
    message:
      "Pacific Crest would be a strong regional complement to our West Coast operations. We are open to a minority structure that keeps majority ownership with you and preserves the MBE certification. Could we schedule an introductory call with you and your COO?",
    criteriaFit: "Strong fit: within all stated investment criteria",
    capitalAvailable: "Balance sheet capital, available now",
    timeline: "IOI within 30 days",
    createdAt: "2026-10-21T17:05:00.000Z",
  },
  {
    id: "inq-6003",
    dealId: "d-1007",
    investorUserId: "u-inv-stonebridge",
    message:
      "We invest permanent capital and are comfortable as a long-term minority partner. We would like to understand the San Diego expansion plan and how the healthcare EVS business has performed over the last two years.",
    criteriaFit: "Strong fit: within all stated investment criteria",
    capitalAvailable: "Balance sheet capital, available now",
    timeline: "IOI within 60 days",
    createdAt: "2026-10-30T15:20:00.000Z",
  },
  {
    id: "inq-6004",
    dealId: "d-1010",
    investorUserId: "u-inv-stonebridge",
    message:
      "Congratulations on the retail expansion. We have backed two consumer brands through similar door growth and can make introductions to a specialty beauty buyer. We would like to discuss inventory planning for the spring launch.",
    criteriaFit: "Strong fit: within all stated investment criteria",
    capitalAvailable: "Balance sheet capital, available now",
    timeline: "Ready to submit an IOI within 2 weeks",
    createdAt: "2026-11-09T14:00:00.000Z",
  },
];

export const SEED_MESSAGES: Message[] = [
  { id: "msg-7001", threadId: threadId("d-1004", "u-inv-harbor"), senderUserId: "u-inv-harbor", body: SEED_INQUIRIES[0].message, createdAt: SEED_INQUIRIES[0].createdAt },
  { id: "msg-7002", threadId: threadId("d-1004", "u-inv-harbor"), senderUserId: "u-own-1004", body: "Thank you, Jordan. I am happy to walk through our referral process. Patricia Owens, our Director of Clinical Services, will join the call. Would Tuesday the 22nd at 10:00 a.m. Eastern work?", createdAt: "2026-09-15T13:42:00.000Z" },
  { id: "msg-7003", threadId: threadId("d-1004", "u-inv-harbor"), senderUserId: "u-inv-harbor", body: "Tuesday at 10:00 works. I will send a short agenda in advance.", createdAt: "2026-09-15T15:01:00.000Z" },

  { id: "msg-7004", threadId: threadId("d-1007", "u-inv-allied"), senderUserId: "u-inv-allied", body: SEED_INQUIRIES[1].message, createdAt: SEED_INQUIRIES[1].createdAt },
  { id: "msg-7005", threadId: threadId("d-1007", "u-inv-allied"), senderUserId: "u-own-1007", body: "Thank you, Sarah. Keeping the certification intact is important to us and to several of our clients. Robert and I are available the weeks of November 16 and November 23. Please send a few times that work for your team.", createdAt: "2026-10-23T16:15:00.000Z" },
  { id: "msg-7006", threadId: threadId("d-1007", "u-inv-allied"), senderUserId: "u-inv-allied", body: "Wednesday, November 18 at 2:00 p.m. Pacific works for us. Ahead of the call, could you share a site-level revenue summary for the healthcare accounts?", createdAt: "2026-11-11T18:20:00.000Z" },

  { id: "msg-7007", threadId: threadId("d-1007", "u-inv-stonebridge"), senderUserId: "u-inv-stonebridge", body: SEED_INQUIRIES[2].message, createdAt: SEED_INQUIRIES[2].createdAt },

  { id: "msg-7008", threadId: threadId("d-1010", "u-inv-stonebridge"), senderUserId: "u-inv-stonebridge", body: SEED_INQUIRIES[3].message, createdAt: SEED_INQUIRIES[3].createdAt },
  { id: "msg-7009", threadId: threadId("d-1010", "u-inv-stonebridge"), senderUserId: "u-own-1010", body: "Thank you, Evelyn. The specialty beauty introduction would be valuable. I can share our spring inventory plan and door-level sell-through data. Are you available Thursday afternoon?", createdAt: "2026-11-10T19:30:00.000Z" },
];

export const SEED_SAVED_DEALS: SavedDeal[] = [
  { investorUserId: "u-inv-northgate", dealId: "d-1009", savedAt: "2026-10-12T14:00:00.000Z" },
  { investorUserId: "u-inv-northgate", dealId: "d-1005", savedAt: "2026-11-04T16:30:00.000Z" },
  { investorUserId: "u-inv-stonebridge", dealId: "d-1010", savedAt: "2026-11-07T15:00:00.000Z" },
  { investorUserId: "u-inv-stonebridge", dealId: "d-1012", savedAt: "2026-10-29T15:00:00.000Z" },
];

export const EMPTY_FILTERS: DealFilters = {
  query: "",
  industries: [],
  regions: [],
  states: [],
  revenueBands: [],
  ebitdaBands: [],
  dealTypes: [],
  certifications: [],
  minYears: 0,
  matchCriteria: false,
};

export const SEED_SAVED_SEARCHES: SavedSearch[] = [
  {
    id: "ss-8001",
    investorUserId: "u-inv-northgate",
    name: "Control deals, $2.5M+ EBITDA",
    filters: { ...EMPTY_FILTERS, dealTypes: ["majority", "full_exit"], ebitdaBands: ["2.5-5", "gt5"] },
    createdAt: "2026-10-03T15:00:00.000Z",
  },
  {
    id: "ss-8002",
    investorUserId: "u-inv-northgate",
    name: "IT services, any structure",
    filters: { ...EMPTY_FILTERS, industries: ["IT Services"] },
    createdAt: "2026-10-18T15:00:00.000Z",
  },
  {
    id: "ss-8003",
    investorUserId: "u-inv-stonebridge",
    name: "Consumer and food, minority or growth",
    filters: { ...EMPTY_FILTERS, industries: ["Consumer Products", "Food Manufacturing"], dealTypes: ["minority", "growth"] },
    createdAt: "2026-09-30T15:00:00.000Z",
  },
];

export const SEED_ACTIVITY: ActivityEvent[] = [
  { id: "act-9001", kind: "listing_approved", actorUserId: "u-admin-1", dealId: "d-1009", detail: "Listing approved and published", createdAt: "2026-08-19T14:00:00.000Z" },
  { id: "act-9002", kind: "listing_approved", actorUserId: "u-admin-1", dealId: "d-1004", detail: "Listing approved and published", createdAt: "2026-08-27T13:45:00.000Z" },
  { id: "act-9003", kind: "nda_signed", actorUserId: "u-inv-harbor", dealId: "d-1004", detail: "Harbor Lane Capital signed the NDA", createdAt: "2026-09-12T15:22:00.000Z" },
  { id: "act-9004", kind: "inquiry_sent", actorUserId: "u-inv-harbor", dealId: "d-1004", detail: "Harbor Lane Capital sent an inquiry", createdAt: "2026-09-14T14:10:00.000Z" },
  { id: "act-9005", kind: "nda_signed", actorUserId: "u-inv-fulcrum", dealId: "d-1001", detail: "Fulcrum Street Partners signed the NDA", createdAt: "2026-10-09T18:05:00.000Z" },
  { id: "act-9006", kind: "nda_signed", actorUserId: "u-inv-allied", dealId: "d-1007", detail: "Allied Facility Group signed the NDA", createdAt: "2026-10-20T16:40:00.000Z" },
  { id: "act-9007", kind: "inquiry_sent", actorUserId: "u-inv-allied", dealId: "d-1007", detail: "Allied Facility Group sent an inquiry", createdAt: "2026-10-21T17:05:00.000Z" },
  { id: "act-9008", kind: "nda_signed", actorUserId: "u-inv-stonebridge", dealId: "d-1003", detail: "Stonebridge Family Office signed the NDA", createdAt: "2026-10-25T14:12:00.000Z" },
  { id: "act-9009", kind: "nda_signed", actorUserId: "u-inv-stonebridge", dealId: "d-1007", detail: "Stonebridge Family Office signed the NDA", createdAt: "2026-10-29T13:31:00.000Z" },
  { id: "act-9010", kind: "inquiry_sent", actorUserId: "u-inv-stonebridge", dealId: "d-1007", detail: "Stonebridge Family Office sent an inquiry", createdAt: "2026-10-30T15:20:00.000Z" },
  { id: "act-9011", kind: "listing_approved", actorUserId: "u-admin-1", dealId: "d-1005", detail: "Listing approved and published", createdAt: "2026-11-03T15:00:00.000Z" },
  { id: "act-9012", kind: "listing_approved", actorUserId: "u-admin-1", dealId: "d-1010", detail: "Listing approved and published", createdAt: "2026-11-06T14:00:00.000Z" },
  { id: "act-9013", kind: "nda_signed", actorUserId: "u-inv-stonebridge", dealId: "d-1010", detail: "Stonebridge Family Office signed the NDA", createdAt: "2026-11-08T15:48:00.000Z" },
  { id: "act-9014", kind: "inquiry_sent", actorUserId: "u-inv-stonebridge", dealId: "d-1010", detail: "Stonebridge Family Office sent an inquiry", createdAt: "2026-11-09T14:00:00.000Z" },
  { id: "act-9015", kind: "listing_submitted", actorUserId: "u-own-1013", dealId: "d-1013", detail: "Listing submitted for review", createdAt: "2026-11-10T16:30:00.000Z" },
  { id: "act-9016", kind: "listing_submitted", actorUserId: "u-own-1014", dealId: "d-1014", detail: "Listing submitted for review", createdAt: "2026-11-12T17:10:00.000Z" },
];

/**
 * Last-read timestamps per user per thread, used for unread badges.
 * Owners of Pacific Crest have unread inquiries so the owner inbox opens with work to do.
 */
export const SEED_READS: Record<string, Record<string, string>> = {
  "u-inv-harbor": { [threadId("d-1004", "u-inv-harbor")]: "2026-09-15T15:01:00.000Z" },
  "u-own-1004": { [threadId("d-1004", "u-inv-harbor")]: "2026-09-15T15:01:00.000Z" },
  "u-inv-allied": { [threadId("d-1007", "u-inv-allied")]: "2026-11-11T18:20:00.000Z" },
  "u-own-1007": { [threadId("d-1007", "u-inv-allied")]: "2026-10-23T16:15:00.000Z" },
  "u-inv-stonebridge": {
    [threadId("d-1007", "u-inv-stonebridge")]: "2026-10-30T15:20:00.000Z",
    [threadId("d-1010", "u-inv-stonebridge")]: "2026-11-09T14:00:00.000Z",
  },
};
