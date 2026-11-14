import type { DealStatus, Message, Role, User } from "@/data/types";
import { getUser } from "@/data/users";
import type { DataState } from "./store";
import type { DealRow } from "./deals";

export function getDeal(data: DataState, id: string) {
  return data.deals.find((d) => d.id === id);
}

export function getBusiness(data: DataState, id: string | undefined) {
  return data.businesses.find((b) => b.id === id);
}

export function dealRows(data: DataState, statuses: DealStatus[] = ["live"]): DealRow[] {
  return data.deals
    .filter((d) => statuses.includes(d.status))
    .map((deal) => ({ deal, business: getBusiness(data, deal.businessId)! }))
    .filter((r) => r.business);
}

export function ndaFor(data: DataState, dealId: string, investorUserId: string) {
  return data.ndas.find((n) => n.dealId === dealId && n.investorUserId === investorUserId);
}

export function inquiryFor(data: DataState, dealId: string, investorUserId: string) {
  return data.inquiries.find((i) => i.dealId === dealId && i.investorUserId === investorUserId);
}

export function profileByUser(data: DataState, userId: string) {
  return data.investorProfiles.find((p) => p.userId === userId);
}

export function dealForOwner(data: DataState, ownerUserId: string) {
  const biz = data.businesses.find((b) => b.ownerUserId === ownerUserId);
  const deal = biz && data.deals.find((d) => d.businessId === biz.id);
  return { business: biz, deal };
}

export function ownerOfDeal(data: DataState, dealId: string) {
  const deal = getDeal(data, dealId);
  const biz = deal && getBusiness(data, deal.businessId);
  return biz ? getUser(biz.ownerUserId) : undefined;
}

export interface Thread {
  id: string;
  dealId: string;
  investorUserId: string;
  messages: Message[];
  last: Message;
  unread: number;
}

export function threadsFor(data: DataState, user: User, role: Role): Thread[] {
  const byThread = new Map<string, Message[]>();
  for (const m of data.messages) {
    const list = byThread.get(m.threadId) ?? [];
    list.push(m);
    byThread.set(m.threadId, list);
  }
  const ownedDealIds =
    role === "owner"
      ? new Set(
          data.deals
            .filter((d) => getBusiness(data, d.businessId)?.ownerUserId === user.id)
            .map((d) => d.id),
        )
      : new Set<string>();

  const threads: Thread[] = [];
  for (const [id, msgs] of byThread) {
    const [dealId, investorUserId] = id.split("__");
    const visible =
      role === "investor" ? investorUserId === user.id : role === "owner" ? ownedDealIds.has(dealId) : true;
    if (!visible) continue;
    const sorted = [...msgs].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const lastRead = data.reads[user.id]?.[id] ?? "";
    const unread = role === "admin" ? 0 : sorted.filter((m) => m.senderUserId !== user.id && m.createdAt > lastRead).length;
    threads.push({ id, dealId, investorUserId, messages: sorted, last: sorted[sorted.length - 1], unread });
  }
  return threads.sort((a, b) => b.last.createdAt.localeCompare(a.last.createdAt));
}

export function unreadTotal(data: DataState, user: User, role: Role) {
  return threadsFor(data, user, role).reduce((n, t) => n + t.unread, 0);
}
