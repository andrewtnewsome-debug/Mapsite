import "server-only";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { classifyNaics } from "./naics";
import { draftSummary } from "./summary";
import type { Db, Note, Provider, Status, Submission, SubmissionInput } from "./types";

/**
 * Local JSON "database" for the prototype. Phase 1 swaps this module for Supabase;
 * every page goes through these functions, so nothing else needs to change.
 */

const DATA_DIR = join(process.cwd(), "data");
const DB_PATH = join(DATA_DIR, "db.json");
const SEED_PATH = join(DATA_DIR, "seed.json");

type SeedSubmission = SubmissionInput & Pick<Submission, "id" | "createdAt" | "status" | "notes" | "introductions">;

function enrich(input: SubmissionInput, at: Date): Pick<Submission, "naics" | "ai"> {
  const naics = classifyNaics(input.company.name, input.company.description);
  return { naics, ai: draftSummary(input, naics, at) };
}

function load(): Db {
  const seed = JSON.parse(readFileSync(SEED_PATH, "utf8")) as { submissions: SeedSubmission[]; providers: Provider[] };
  if (!existsSync(DB_PATH)) {
    const db: Db = {
      providers: seed.providers,
      submissions: seed.submissions.map((s) => ({
        ...s,
        ...enrich(s, new Date(new Date(s.createdAt).getTime() + 90_000)),
      })),
    };
    save(db);
    return db;
  }
  // Providers always come from seed.json (written by scripts/import_providers.py); only submissions persist here.
  const saved = JSON.parse(readFileSync(DB_PATH, "utf8")) as Db;
  return { ...saved, providers: seed.providers };
}

function save(db: Db) {
  writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

export function listSubmissions(): Submission[] {
  return load().submissions.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getSubmission(id: string): Submission | undefined {
  return load().submissions.find((s) => s.id === id);
}

export function listProviders(): Provider[] {
  return load().providers.sort((a, b) => a.name.localeCompare(b.name));
}

export function getProvider(id: string): Provider | undefined {
  return load().providers.find((p) => p.id === id);
}

export function createSubmission(input: SubmissionInput): Submission {
  const db = load();
  const now = new Date();
  const submission: Submission = {
    ...input,
    id: `sub_${randomUUID().slice(0, 8)}`,
    createdAt: now.toISOString(),
    status: "new",
    notes: [],
    introductions: [],
    ...enrich(input, now),
  };
  db.submissions.push(submission);
  save(db);
  return submission;
}

function updateSubmission(id: string, change: (s: Submission) => void) {
  const db = load();
  const s = db.submissions.find((x) => x.id === id);
  if (!s) throw new Error(`Submission ${id} not found`);
  change(s);
  save(db);
}

export function setStatus(id: string, status: Status) {
  updateSubmission(id, (s) => {
    s.status = status;
  });
}

export function addNote(id: string, note: Note) {
  updateSubmission(id, (s) => {
    s.notes.push(note);
  });
}

export function logIntroduction(id: string, providerId: string) {
  updateSubmission(id, (s) => {
    if (s.introductions.some((i) => i.providerId === providerId)) return;
    s.introductions.push({ providerId, at: new Date().toISOString() });
    if (s.status === "new" || s.status === "in_review") s.status = "introduced";
  });
}
