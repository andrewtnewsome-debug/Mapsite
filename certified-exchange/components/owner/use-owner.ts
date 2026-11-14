"use client";

import { dealForOwner, threadsFor } from "@/lib/selectors";
import { useStore } from "@/lib/store";

/** The signed-in owner's business, listing and engagement numbers. */
export function useOwnerListing() {
  const { data, currentUser, session } = useStore();
  const { business, deal } = dealForOwner(data, currentUser.id);
  const ndas = deal ? data.ndas.filter((n) => n.dealId === deal.id).sort((a, b) => b.signedAt.localeCompare(a.signedAt)) : [];
  const inquiries = deal ? data.inquiries.filter((i) => i.dealId === deal.id) : [];
  const saves = deal ? data.savedDeals.filter((s) => s.dealId === deal.id).length : 0;
  const threads = threadsFor(data, currentUser, session.role);
  const unread = threads.reduce((n, t) => n + t.unread, 0);
  return { business, deal, ndas, inquiries, saves, threads, unread };
}
