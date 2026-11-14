"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { brand } from "@/config/brand";
import { BUSINESSES } from "@/data/businesses";
import { DEALS } from "@/data/deals";
import { INVESTOR_PROFILES } from "@/data/investors";
import {
  SEED_ACTIVITY,
  SEED_INQUIRIES,
  SEED_MESSAGES,
  SEED_NDAS,
  SEED_READS,
  SEED_SAVED_DEALS,
  SEED_SAVED_SEARCHES,
  threadId as makeThreadId,
} from "@/data/seed";
import type {
  ActivityEvent,
  ActivityKind,
  CertifiedBusiness,
  Deal,
  DealFilters,
  Inquiry,
  InvestorProfile,
  Message,
  NDA,
  Role,
  SavedDeal,
  SavedSearch,
  User,
} from "@/data/types";
import { DEFAULT_ADMIN_ID, DEFAULT_INVESTOR_ID, DEFAULT_OWNER_ID, getUser } from "@/data/users";
import { uid } from "./utils";

// ---------------------------------------------------------------------------
// State shape
// ---------------------------------------------------------------------------

export interface DataState {
  deals: Deal[];
  businesses: CertifiedBusiness[];
  investorProfiles: InvestorProfile[];
  ndas: NDA[];
  inquiries: Inquiry[];
  messages: Message[];
  savedDeals: SavedDeal[];
  savedSearches: SavedSearch[];
  activity: ActivityEvent[];
  /** userId -> threadId -> last read ISO timestamp */
  reads: Record<string, Record<string, string>>;
}

export interface SessionState {
  role: Role;
  investorId: string;
  ownerId: string;
}

interface Persisted {
  version: 1;
  data: DataState;
  session: SessionState;
}

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

export function seedData(): DataState {
  return clone({
    deals: DEALS,
    businesses: BUSINESSES,
    investorProfiles: INVESTOR_PROFILES,
    ndas: SEED_NDAS,
    inquiries: SEED_INQUIRIES,
    messages: SEED_MESSAGES,
    savedDeals: SEED_SAVED_DEALS,
    savedSearches: SEED_SAVED_SEARCHES,
    activity: SEED_ACTIVITY,
    reads: SEED_READS,
  });
}

const DEFAULT_SESSION: SessionState = { role: "investor", investorId: DEFAULT_INVESTOR_ID, ownerId: DEFAULT_OWNER_ID };

function load(): Persisted | null {
  try {
    const raw = window.localStorage.getItem(brand.storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Persisted;
    if (parsed?.version !== 1 || !parsed.data?.deals) return null;
    return parsed;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

export interface StoreValue {
  hydrated: boolean;
  data: DataState;
  session: SessionState;
  currentUser: User;
  /** Persona switching (stands in for login). */
  setRole: (role: Role) => { autoSelectedOwner?: User };
  setInvestor: (userId: string) => void;
  setOwner: (userId: string) => void;
  resetDemo: () => void;
  // Investor actions
  signNda: (input: { dealId: string; signedName: string; signedTitle: string; firmName: string }) => NDA;
  sendInquiry: (input: Omit<Inquiry, "id" | "createdAt" | "investorUserId">) => Inquiry;
  toggleSaveDeal: (dealId: string) => boolean;
  saveSearch: (name: string, filters: DealFilters) => SavedSearch;
  deleteSearch: (id: string) => void;
  updateInvestorProfile: (profileId: string, patch: Partial<InvestorProfile>) => void;
  // Messaging
  sendMessage: (threadId: string, body: string) => void;
  markThreadRead: (threadId: string) => void;
  // Owner actions
  updateDeal: (dealId: string, patch: Partial<Deal>) => void;
  updateBusiness: (businessId: string, patch: Partial<CertifiedBusiness>) => void;
  submitForReview: (dealId: string) => void;
  setDealPaused: (dealId: string, paused: boolean) => void;
  // Admin actions
  approveDeal: (dealId: string) => void;
  requestChanges: (dealId: string, note: string) => void;
  verifyCertification: (businessId: string) => void;
  setInvestorVerified: (profileId: string, verified: boolean) => void;
}

const StoreContext = createContext<StoreValue | null>(null);

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [hydrated, setHydrated] = useState(false);
  const [data, setData] = useState<DataState>(seedData);
  const [session, setSession] = useState<SessionState>(DEFAULT_SESSION);
  const skipNextWrite = useRef(false);

  // Load persisted state once on the client.
  useEffect(() => {
    const saved = load();
    if (saved) {
      setData(saved.data);
      setSession({ ...DEFAULT_SESSION, ...saved.session });
    }
    setHydrated(true);
  }, []);

  // Persist on change.
  useEffect(() => {
    if (!hydrated) return;
    if (skipNextWrite.current) {
      skipNextWrite.current = false;
      return;
    }
    try {
      const payload: Persisted = { version: 1, data, session };
      window.localStorage.setItem(brand.storageKey, JSON.stringify(payload));
    } catch {
      // Storage may be unavailable (private mode). The demo still works in memory.
    }
  }, [data, session, hydrated]);

  // Keep platform data in sync across tabs (e.g. investor and owner side by side),
  // while each tab keeps its own role.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== brand.storageKey || !e.newValue) return;
      try {
        const next = JSON.parse(e.newValue) as Persisted;
        if (next?.version === 1 && next.data) {
          skipNextWrite.current = true;
          setData(next.data);
        }
      } catch {
        /* ignore */
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const currentUserId =
    session.role === "investor" ? session.investorId : session.role === "owner" ? session.ownerId : DEFAULT_ADMIN_ID;
  const currentUser = getUser(currentUserId)!;

  const log = useCallback(
    (kind: ActivityKind, actorUserId: string, detail: string, extra: Partial<ActivityEvent> = {}): ActivityEvent => ({
      id: uid("act"),
      kind,
      actorUserId,
      detail,
      createdAt: new Date().toISOString(),
      ...extra,
    }),
    [],
  );

  const now = () => new Date().toISOString();

  const setRole = useCallback(
    (role: Role) => {
      let autoSelectedOwner: User | undefined;
      if (role === "owner") {
        // Continue the demo story: open the owner of the deal this investor last engaged with.
        const mine = [
          ...data.inquiries.filter((i) => i.investorUserId === session.investorId).map((i) => ({ dealId: i.dealId, at: i.createdAt })),
          ...data.ndas.filter((n) => n.investorUserId === session.investorId).map((n) => ({ dealId: n.dealId, at: n.signedAt })),
        ].sort((a, b) => b.at.localeCompare(a.at));
        const deal = mine[0] && data.deals.find((d) => d.id === mine[0].dealId);
        const biz = deal && data.businesses.find((b) => b.id === deal.businessId);
        if (biz && biz.ownerUserId !== session.ownerId) {
          autoSelectedOwner = getUser(biz.ownerUserId);
          setSession((s) => ({ ...s, role, ownerId: biz.ownerUserId }));
          return { autoSelectedOwner };
        }
      }
      setSession((s) => ({ ...s, role }));
      return { autoSelectedOwner };
    },
    [data.inquiries, data.ndas, data.deals, data.businesses, session.investorId, session.ownerId],
  );

  const value = useMemo<StoreValue>(() => {
    const uidNow = currentUser.id;
    return {
      hydrated,
      data,
      session,
      currentUser,
      setRole,
      setInvestor: (userId) => setSession((s) => ({ ...s, role: "investor", investorId: userId })),
      setOwner: (userId) => setSession((s) => ({ ...s, role: "owner", ownerId: userId })),
      resetDemo: () => {
        try {
          window.localStorage.removeItem(brand.storageKey);
        } catch {
          /* ignore */
        }
        setData(seedData());
        setSession(DEFAULT_SESSION);
      },

      signNda: ({ dealId, signedName, signedTitle, firmName }) => {
        const nda: NDA = {
          id: uid("nda"),
          dealId,
          investorUserId: uidNow,
          signedName: signedName.trim(),
          signedTitle: signedTitle.trim(),
          firmName: firmName.trim(),
          signedAt: now(),
          version: brand.ndaVersion,
        };
        setData((d) => ({
          ...d,
          ndas: [...d.ndas.filter((n) => !(n.dealId === dealId && n.investorUserId === uidNow)), nda],
          activity: [...d.activity, log("nda_signed", uidNow, `${nda.firmName} signed the NDA`, { dealId })],
        }));
        return nda;
      },

      sendInquiry: (input) => {
        const inquiry: Inquiry = { ...input, id: uid("inq"), investorUserId: uidNow, createdAt: now() };
        const tId = makeThreadId(input.dealId, uidNow);
        const msg: Message = { id: uid("msg"), threadId: tId, senderUserId: uidNow, body: input.message.trim(), createdAt: inquiry.createdAt };
        setData((d) => ({
          ...d,
          inquiries: [...d.inquiries, inquiry],
          messages: [...d.messages, msg],
          reads: { ...d.reads, [uidNow]: { ...(d.reads[uidNow] ?? {}), [tId]: inquiry.createdAt } },
          activity: [...d.activity, log("inquiry_sent", uidNow, `${currentUser.firmName} sent an inquiry`, { dealId: input.dealId })],
        }));
        return inquiry;
      },

      toggleSaveDeal: (dealId) => {
        const exists = data.savedDeals.some((s) => s.dealId === dealId && s.investorUserId === uidNow);
        setData((d) => ({
          ...d,
          savedDeals: exists
            ? d.savedDeals.filter((s) => !(s.dealId === dealId && s.investorUserId === uidNow))
            : [...d.savedDeals, { dealId, investorUserId: uidNow, savedAt: now() }],
        }));
        return !exists;
      },

      saveSearch: (name, filters) => {
        const s: SavedSearch = { id: uid("ss"), investorUserId: uidNow, name: name.trim(), filters: clone(filters), createdAt: now() };
        setData((d) => ({ ...d, savedSearches: [...d.savedSearches, s] }));
        return s;
      },

      deleteSearch: (id) => setData((d) => ({ ...d, savedSearches: d.savedSearches.filter((s) => s.id !== id) })),

      updateInvestorProfile: (profileId, patch) =>
        setData((d) => ({ ...d, investorProfiles: d.investorProfiles.map((p) => (p.id === profileId ? { ...p, ...patch } : p)) })),

      sendMessage: (tId, body) => {
        const msg: Message = { id: uid("msg"), threadId: tId, senderUserId: uidNow, body: body.trim(), createdAt: now() };
        const [dealId] = tId.split("__");
        setData((d) => ({
          ...d,
          messages: [...d.messages, msg],
          reads: { ...d.reads, [uidNow]: { ...(d.reads[uidNow] ?? {}), [tId]: msg.createdAt } },
          activity: [...d.activity, log("message_sent", uidNow, `${currentUser.name} sent a message`, { dealId })],
        }));
      },

      markThreadRead: (tId) =>
        setData((d) => {
          const latest = d.messages.filter((m) => m.threadId === tId).reduce((acc, m) => (m.createdAt > acc ? m.createdAt : acc), "");
          if (!latest || (d.reads[uidNow]?.[tId] ?? "") >= latest) return d;
          return { ...d, reads: { ...d.reads, [uidNow]: { ...(d.reads[uidNow] ?? {}), [tId]: latest } } };
        }),

      updateDeal: (dealId, patch) => setData((d) => ({ ...d, deals: d.deals.map((x) => (x.id === dealId ? { ...x, ...patch } : x)) })),

      updateBusiness: (businessId, patch) =>
        setData((d) => ({ ...d, businesses: d.businesses.map((b) => (b.id === businessId ? { ...b, ...patch } : b)) })),

      submitForReview: (dealId) =>
        setData((d) => ({
          ...d,
          deals: d.deals.map((x) => (x.id === dealId ? { ...x, status: "pending_review", submittedAt: now(), reviewNote: undefined } : x)),
          activity: [...d.activity, log("listing_submitted", uidNow, "Listing submitted for review", { dealId })],
        })),

      setDealPaused: (dealId, paused) =>
        setData((d) => ({
          ...d,
          deals: d.deals.map((x) => (x.id === dealId ? { ...x, status: paused ? "paused" : "live" } : x)),
          activity: [...d.activity, log(paused ? "listing_paused" : "listing_resumed", uidNow, paused ? "Listing paused by owner" : "Listing resumed by owner", { dealId })],
        })),

      approveDeal: (dealId) =>
        setData((d) => ({
          ...d,
          deals: d.deals.map((x) => (x.id === dealId ? { ...x, status: "live", listedAt: now(), reviewNote: undefined } : x)),
          activity: [...d.activity, log("listing_approved", uidNow, "Listing approved and published", { dealId })],
        })),

      requestChanges: (dealId, note) =>
        setData((d) => ({
          ...d,
          deals: d.deals.map((x) => (x.id === dealId ? { ...x, status: "changes_requested", reviewNote: note.trim() } : x)),
          activity: [...d.activity, log("changes_requested", uidNow, "Changes requested on listing", { dealId })],
        })),

      verifyCertification: (businessId) =>
        setData((d) => ({
          ...d,
          businesses: d.businesses.map((b) => (b.id === businessId ? { ...b, verification: "verified", verifiedAt: now() } : b)),
          activity: [...d.activity, log("cert_verified", uidNow, "Certification verified with certifying council", { subjectId: businessId })],
        })),

      setInvestorVerified: (profileId, verified) =>
        setData((d) => {
          const p = d.investorProfiles.find((x) => x.id === profileId);
          return {
            ...d,
            investorProfiles: d.investorProfiles.map((x) => (x.id === profileId ? { ...x, verified } : x)),
            activity: [
              ...d.activity,
              log(verified ? "investor_verified" : "investor_unverified", uidNow, `${p?.firmName ?? "Investor"} ${verified ? "marked verified" : "verification removed"}`, { subjectId: profileId }),
            ],
          };
        }),
    };
  }, [hydrated, data, session, currentUser, setRole, log]);

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used inside StoreProvider");
  return ctx;
}
