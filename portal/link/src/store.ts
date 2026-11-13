import seed from "portal/data/seed.json";
// Confidential deals for the private link only. The file is git-ignored; the build creates an empty one if it is missing.
import privateDeals from "./private-deals.json";
import { enrichSubmission as enrich } from "portal/lib/enrich";
import type { Note, OnePager, Provider, Status, Submission, SubmissionInput } from "portal/lib/types";

/**
 * Where the link version keeps deals.
 * - "shared": the artifact's database, one document per deal under `deals/`. Everyone the link is
 *   shared with sees the same list, live. Used whenever this view can reach the database.
 * - "local": this browser only, with the sample deals. Used outside a Claude viewer.
 * Capital providers always come from the imported research list.
 */

interface DocSnap { id: string; exists: boolean; data(): Record<string, unknown> | undefined }
interface QuerySnap { docs: DocSnap[]; metadata: { fromCache: boolean } }
interface DbCap {
  doc(path: string): { set(data: Record<string, unknown>): Promise<void> };
  collection(path: string): { onSnapshot(next: (s: QuerySnap) => void, error?: (e: { code?: string }) => void): () => void };
}
interface UserCap {
  id(): Promise<string | null>;
  can(name: string): Promise<boolean | null>;
  profiles(ids: string[]): Promise<Record<string, { name: string }>>;
}

const LOCAL_KEY = "maplab-portal-v4";
const MOVED_KEY = "maplab-portal-moved";
const providers = (seed as unknown as { providers: Provider[] }).providers;
type SeedSubmission = SubmissionInput & Pick<Submission, "id" | "createdAt" | "status" | "notes" | "introductions">;

export interface StoreStatus {
  mode: "starting" | "shared" | "local";
  /** Shared mode: the first answer from the database hasn't arrived yet. */
  loading: boolean;
  /** Shared mode: no confirmed answer after ten seconds; what's shown may be out of date. */
  slow: boolean;
  /** This viewer can look but not change deals. */
  readOnly: boolean;
  /** A problem worth telling the viewer about, in plain words. */
  notice: string | null;
  /** Deals saved only in this browser that could be moved to the shared list. */
  localOnly: Submission[];
}

let submissions: Submission[] = [];
let status: StoreStatus = { mode: "starting", loading: true, slow: false, readOnly: false, notice: null, localOnly: [] };
let shared: DbCap | null = null;
let user: UserCap | null = null;
let myId: string | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const setStatusFields = (patch: Partial<StoreStatus>) => { status = { ...status, ...patch }; emit(); };

// ── Local storage (the fallback, and the source for "move to shared") ──

function sampleDeals(): Submission[] {
  const s = seed as unknown as { submissions: SeedSubmission[] };
  return [...s.submissions, ...(privateDeals as unknown as SeedSubmission[])].map((x) => ({
    ...x,
    ...enrich(x, new Date(new Date(x.createdAt).getTime() + 90_000)),
  }));
}

function readLocal(): Submission[] | null {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    return raw ? ((JSON.parse(raw) as { submissions?: Submission[] }).submissions ?? null) : null;
  } catch {
    return null;
  }
}

function writeLocal() {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify({ submissions }));
  } catch {
    // Storage blocked: changes still live for this visit.
  }
}

/** Real deals in this browser: everything except the built-in samples, minus any already moved. */
function movableLocalDeals(): Submission[] {
  let moved: string[] = [];
  try {
    moved = JSON.parse(localStorage.getItem(MOVED_KEY) ?? "[]") as string[];
  } catch {
    // none recorded
  }
  return (readLocal() ?? sampleDeals()).filter((s) => !s.id.startsWith("sub_seed") && !moved.includes(s.id));
}

// ── Start-up ──

function startLocal() {
  const saved = readLocal();
  // Keep the browser's saved deals, and add any sample or private deal published since it last saved.
  submissions = saved ? [...saved, ...sampleDeals().filter((d) => !saved.some((x) => x.id === d.id))] : sampleDeals();
  setStatusFields({ mode: "local", loading: false });
}

async function start() {
  const use = (name: string) => window.claude?.use(name).catch(() => null) ?? Promise.resolve(null);
  const [db, u] = await Promise.all([use("db"), use("user")]);
  if (!db) return startLocal();
  shared = db as DbCap;
  user = u as UserCap | null;
  myId = (await user?.id().catch(() => null)) ?? null;
  const canWrite = (await user?.can("data.write").catch(() => null)) ?? null;
  setStatusFields({ mode: "shared", readOnly: canWrite === false, localOnly: movableLocalDeals() });

  const timer = setTimeout(() => setStatusFields({ slow: true }), 10_000);
  shared.collection("deals").onSnapshot(
    (snap) => {
      // Snapshots are frozen; keep our own copies so edits can be prepared before writing.
      submissions = snap.docs.flatMap((d) => (d.exists && d.data() ? [JSON.parse(JSON.stringify(d.data())) as Submission] : []));
      if (!snap.metadata.fromCache) clearTimeout(timer);
      setStatusFields({ loading: false, slow: snap.metadata.fromCache ? status.slow : false, localOnly: movableLocalDeals().filter((l) => !submissions.some((s) => s.id === l.id)) });
    },
    (e) => {
      clearTimeout(timer);
      setStatusFields({ loading: false, slow: false, notice: e?.code === "revoked" ? "Your access to the shared deals changed. Reload the page." : "The shared deals can't be reached right now. Reload to try again." });
    },
  );
}

if (typeof window !== "undefined") void start();

// ── Reads ──

export function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}
export const getStatus = () => status;
export const listSubmissions = () => [...submissions].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
export const getSubmission = (id: string) => submissions.find((s) => s.id === id);
export const listProviders = () => [...providers].sort((a, b) => a.name.localeCompare(b.name));
export const getProvider = (id: string) => providers.find((p) => p.id === id);
export const dismissNotice = () => setStatusFields({ notice: null });

/** Display names for note authors; ids that can't be resolved are left out. */
export async function namesFor(ids: string[]): Promise<Record<string, string>> {
  if (!user || ids.length === 0) return {};
  const ps = await user.profiles(ids).catch(() => ({}) as Record<string, { name: string }>);
  return Object.fromEntries(Object.entries(ps).flatMap(([id, p]) => (p.name ? [[id, p.name]] : [])));
}

// ── Writes ──

// One write at a time per deal: each waits for the one before it.
const queues = new Map<string, Promise<void>>();

function persist(s: Submission) {
  if (!shared) return writeLocal();
  const db = shared;
  const body = JSON.parse(JSON.stringify(s)) as Record<string, unknown>;
  const run = (queues.get(s.id) ?? Promise.resolve()).then(() =>
    db.doc(`deals/${s.id}`).set(body).catch((e: { code?: string }) => {
      const code = e?.code ?? "";
      setStatusFields(
        code === "invalid_argument"
          ? { readOnly: true, notice: "That change wasn't saved: you have view-only access. Ask the owner for edit access." }
          : code === "quota_exceeded"
            ? { notice: "That change wasn't saved: the shared list is full. Remove old deals first." }
            : { notice: "That change wasn't saved. Check your connection and try again." },
      );
    }),
  );
  queues.set(s.id, run);
}

export function createSubmission(input: SubmissionInput): Submission {
  const now = new Date();
  const submission: Submission = {
    ...input,
    id: `sub_${Math.random().toString(16).slice(2, 10)}`,
    createdAt: now.toISOString(),
    status: "new",
    notes: [],
    introductions: [],
    ...enrich(input, now),
  };
  submissions = [...submissions, submission];
  persist(submission);
  emit();
  return submission;
}

function update(id: string, change: (s: Submission) => void) {
  const s = submissions.find((x) => x.id === id);
  if (!s) return;
  change(s);
  persist(s);
  emit();
}

export const setStatus = (id: string, next: Status) => update(id, (s) => { s.status = next; });
export const addNote = (id: string, note: Note) =>
  update(id, (s) => { s.notes.push(myId ? { ...note, author: "Team member", authorId: myId } : note); });
export const logIntroduction = (id: string, providerId: string) =>
  update(id, (s) => {
    if (s.introductions.some((i) => i.providerId === providerId)) return;
    s.introductions.push({ providerId, at: new Date().toISOString() });
    if (s.status === "new" || s.status === "in_review") s.status = "introduced";
  });
export const saveOnePager = (id: string, onePager: OnePager) => update(id, (s) => { s.onePager = onePager; });

/** Local mode only: back to the sample deals. */
export function resetData() {
  if (shared) return;
  submissions = sampleDeals();
  writeLocal();
  emit();
}

/** Copies this browser's own deals into the shared list, and remembers that it did. */
export function moveLocalToShared() {
  if (!shared) return;
  const moving = status.localOnly;
  for (const s of moving) {
    if (!submissions.some((x) => x.id === s.id)) submissions = [...submissions, s];
    persist(s);
  }
  try {
    const moved = JSON.parse(localStorage.getItem(MOVED_KEY) ?? "[]") as string[];
    localStorage.setItem(MOVED_KEY, JSON.stringify([...moved, ...moving.map((s) => s.id)]));
  } catch {
    // Can't record it: the banner may offer these again, and moving twice is harmless.
  }
  setStatusFields({ localOnly: [] });
}

/** Hides the offer to move this browser's deals without moving them. */
export function keepLocalOnly() {
  try {
    const moved = JSON.parse(localStorage.getItem(MOVED_KEY) ?? "[]") as string[];
    localStorage.setItem(MOVED_KEY, JSON.stringify([...moved, ...status.localOnly.map((s) => s.id)]));
  } catch {
    // Not recorded; it will be offered again next visit.
  }
  setStatusFields({ localOnly: [] });
}
