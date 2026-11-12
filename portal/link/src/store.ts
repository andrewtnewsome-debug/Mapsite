import seed from "portal/data/seed.json";
// Confidential deals for the private link only. The file is git-ignored; the build creates an empty one if it is missing.
import privateDeals from "./private-deals.json";
import { enrichSubmission as enrich } from "portal/lib/enrich";
import type { Db, Note, OnePager, Provider, Status, Submission, SubmissionInput } from "portal/lib/types";

// Browser version of lib/db.ts: same functions, saved in this browser instead of a JSON file.

const KEY = "maplab-portal-v4";
type SeedSubmission = SubmissionInput & Pick<Submission, "id" | "createdAt" | "status" | "notes" | "introductions">;

let db: Db = read() ?? fresh();
const listeners = new Set<() => void>();

function fresh(): Db {
  const s = seed as unknown as { submissions: SeedSubmission[]; providers: Provider[] };
  return {
    providers: s.providers,
    submissions: [...s.submissions, ...(privateDeals as unknown as SeedSubmission[])].map((x) => ({
      ...x,
      ...enrich(x, new Date(new Date(x.createdAt).getTime() + 90_000)),
    })),
  };
}

function read(): Db | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    // Providers always come from the imported list; only submissions are kept per browser.
    const saved = JSON.parse(raw) as Db;
    return { ...saved, providers: (seed as unknown as { providers: Provider[] }).providers };
  } catch {
    return null;
  }
}

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(db));
  } catch {
    // Storage blocked: changes still live for this visit.
  }
  listeners.forEach((l) => l());
}

export function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function resetData() {
  db = fresh();
  save();
}

export const listSubmissions = () => [...db.submissions].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
export const getSubmission = (id: string) => db.submissions.find((s) => s.id === id);
export const listProviders = () => [...db.providers].sort((a, b) => a.name.localeCompare(b.name));
export const getProvider = (id: string) => db.providers.find((p) => p.id === id);

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
  db.submissions.push(submission);
  save();
  return submission;
}

function update(id: string, change: (s: Submission) => void) {
  const s = db.submissions.find((x) => x.id === id);
  if (!s) return;
  change(s);
  save();
}

export const setStatus = (id: string, status: Status) => update(id, (s) => { s.status = status; });
export const addNote = (id: string, note: Note) => update(id, (s) => { s.notes.push(note); });
export const logIntroduction = (id: string, providerId: string) =>
  update(id, (s) => {
    if (s.introductions.some((i) => i.providerId === providerId)) return;
    s.introductions.push({ providerId, at: new Date().toISOString() });
    if (s.status === "new" || s.status === "in_review") s.status = "introduced";
  });

export const saveOnePager = (id: string, onePager: OnePager) => update(id, (s) => { s.onePager = onePager; });
