import seed from "portal/data/seed.json";
import type { Provider } from "portal/lib/types";
import type { Deal } from "portal/lib/stack";

/**
 * Where the internal matching tool keeps its data.
 * - "shared": the artifact's database. `deals/<id>` holds one deal; `lenders/<id>` holds a lender the
 *   team added, or the team's edit of a researched one (same id), or marks one removed.
 *   Everyone the link is shared with sees the same deals and lender list, live.
 * - "local": this browser only, used when the page runs outside a Claude viewer.
 * The researched list from the Minority Business Investor Database is built in; team changes sit on top.
 */

interface DocSnap { id: string; exists: boolean; data(): Record<string, unknown> | undefined }
interface QuerySnap { docs: DocSnap[]; metadata: { fromCache: boolean } }
interface DbCap {
  doc(path: string): { set(data: Record<string, unknown>): Promise<void>; delete(): Promise<void> };
  collection(path: string): { onSnapshot(next: (s: QuerySnap) => void, error?: (e: { code?: string }) => void): () => void };
}
interface UserCap {
  id(): Promise<string | null>;
  can(name: string): Promise<boolean | null>;
  profiles(ids: string[]): Promise<Record<string, { name: string }>>;
}

/** A lender as the team stores it: the profile plus who changed it last. */
export interface LenderRecord {
  provider: Provider;
  updatedAt: string;
  updatedBy: string | null;
  removed: boolean;
}

export interface StoreStatus {
  mode: "starting" | "shared" | "local";
  loading: boolean;
  slow: boolean;
  readOnly: boolean;
  notice: string | null;
}

const LOCAL_KEY = "maplab-match-v1";
const research = (seed as unknown as { providers: Provider[] }).providers;
const researchIds = new Set(research.map((p) => p.id));

let deals: Deal[] = [];
let lenderDocs = new Map<string, LenderRecord>();
let status: StoreStatus = { mode: "starting", loading: true, slow: false, readOnly: false, notice: null };
let shared: DbCap | null = null;
let user: UserCap | null = null;
let me: string | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const patch = (p: Partial<StoreStatus>) => { status = { ...status, ...p }; emit(); };
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

// ── Local fallback ──

function readLocal() {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) return;
    const d = JSON.parse(raw) as { deals?: Deal[]; lenders?: LenderRecord[] };
    deals = d.deals ?? [];
    lenderDocs = new Map((d.lenders ?? []).map((l) => [l.provider.id, l]));
  } catch {
    // Nothing saved, or storage blocked.
  }
}

function writeLocal() {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify({ deals, lenders: Array.from(lenderDocs.values()) }));
  } catch {
    patch({ notice: "This browser won't save changes. They'll last until you close the page." });
  }
}

// ── Start-up ──

async function start() {
  const use = (name: string) => window.claude?.use(name).catch(() => null) ?? Promise.resolve(null);
  const [db, u] = await Promise.all([use("db"), use("user")]);
  user = u as UserCap | null;
  me = (await user?.id().catch(() => null)) ?? null;
  if (!db) {
    readLocal();
    return patch({ mode: "local", loading: false });
  }
  shared = db as DbCap;
  const canWrite = (await user?.can("data.write").catch(() => null)) ?? null;
  patch({ mode: "shared", readOnly: canWrite === false });

  const pending = new Set(["deals", "lenders"]);
  const timer = setTimeout(() => patch({ slow: true }), 10_000);
  const arrived = (name: string, fromCache: boolean) => {
    if (!fromCache) pending.delete(name);
    if (pending.size === 0) { clearTimeout(timer); patch({ loading: false, slow: false }); }
    else if (fromCache) patch({ loading: false });
    else emit();
  };
  const failed = (e: { code?: string }) => {
    clearTimeout(timer);
    patch({ loading: false, slow: false, notice: e?.code === "revoked" ? "Your access to the shared data changed. Reload the page." : "The shared deals and lenders can't be reached right now. Reload to try again." });
  };
  const bodies = (snap: QuerySnap) => snap.docs.flatMap((d) => (d.exists && d.data() ? [clone(d.data()!)] : []));

  shared.collection("deals").onSnapshot((snap) => {
    deals = bodies(snap) as unknown as Deal[];
    arrived("deals", snap.metadata.fromCache);
  }, failed);
  shared.collection("lenders").onSnapshot((snap) => {
    lenderDocs = new Map((bodies(snap) as unknown as LenderRecord[]).filter((l) => l?.provider?.id).map((l) => [l.provider.id, l]));
    arrived("lenders", snap.metadata.fromCache);
  }, failed);
}

if (typeof window !== "undefined") void start();

// ── Reads ──

export function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}
export const getStatus = () => status;
export const myId = () => me;
export const dismissNotice = () => patch({ notice: null });

export const listDeals = () => [...deals].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
export const getDeal = (id: string) => deals.find((d) => d.id === id);

/** Every lender: the research list with the team's edits applied, then the team's own additions. */
export function allLenders(): { provider: Provider; record: LenderRecord | null; builtIn: boolean }[] {
  const out = research.map((p) => {
    const record = lenderDocs.get(p.id) ?? null;
    return { provider: record?.provider ?? p, record, builtIn: true };
  });
  for (const record of lenderDocs.values()) {
    if (!researchIds.has(record.provider.id)) out.push({ provider: record.provider, record, builtIn: false });
  }
  return out.sort((a, b) => a.provider.name.localeCompare(b.provider.name));
}

/** The lenders deals are matched against: everything not removed. */
export const activeLenders = () => allLenders().filter((l) => !l.record?.removed).map((l) => l.provider);
export const getLender = (id: string) => allLenders().find((l) => l.provider.id === id);
export const researchVersion = (id: string) => research.find((p) => p.id === id) ?? null;

/** Display names for viewer ids; ids that can't be resolved are left out. */
export async function namesFor(ids: (string | null)[]): Promise<Record<string, string>> {
  const wanted = Array.from(new Set(ids.filter((x): x is string => !!x)));
  if (!user || wanted.length === 0) return {};
  const ps = await user.profiles(wanted).catch(() => ({}) as Record<string, { name: string }>);
  return Object.fromEntries(Object.entries(ps).flatMap(([id, p]) => (p?.name ? [[id, p.name]] : [])));
}

// ── Writes ──

const queues = new Map<string, Promise<void>>();

function writeFailed(e: { code?: string }) {
  const code = e?.code ?? "";
  patch(
    code === "invalid_argument"
      ? { readOnly: true, notice: "That change wasn't saved. You have view-only access; ask the owner for edit access." }
      : code === "quota_exceeded"
        ? { notice: "That change wasn't saved: the shared database is full. Delete old deals first." }
        : { notice: "That change wasn't saved. Check your connection and try again." },
  );
}

function put(path: string, body: Record<string, unknown> | null) {
  if (!shared) return writeLocal();
  const db = shared;
  const run = (queues.get(path) ?? Promise.resolve()).then(() => (body ? db.doc(path).set(body) : db.doc(path).delete()).catch(writeFailed));
  queues.set(path, run);
}

export function saveDeal(deal: Deal) {
  const next = { ...clone(deal), updatedAt: new Date().toISOString() };
  deals = [...deals.filter((d) => d.id !== deal.id), next];
  put(`deals/${deal.id}`, next as unknown as Record<string, unknown>);
  emit();
  return next;
}

export function deleteDeal(id: string) {
  deals = deals.filter((d) => d.id !== id);
  put(`deals/${id}`, null);
  emit();
}

function putLender(record: LenderRecord) {
  lenderDocs = new Map(lenderDocs).set(record.provider.id, record);
  put(`lenders/${record.provider.id}`, clone(record) as unknown as Record<string, unknown>);
  emit();
}

export function saveLender(provider: Provider) {
  putLender({ provider: clone(provider), updatedAt: new Date().toISOString(), updatedBy: me, removed: lenderDocs.get(provider.id)?.removed ?? false });
}

export function setLenderRemoved(id: string, removed: boolean) {
  const current = getLender(id);
  if (!current) return;
  putLender({ provider: clone(current.provider), updatedAt: new Date().toISOString(), updatedBy: me, removed });
}

/** Researched lenders only: drop the team's edits and go back to the research version. */
export function resetLender(id: string) {
  if (!researchIds.has(id)) return;
  lenderDocs = new Map(lenderDocs);
  lenderDocs.delete(id);
  put(`lenders/${id}`, null);
  emit();
}
