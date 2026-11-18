import "server-only";

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { InvoiceDraftSchema, type InvoiceDraft } from "@/lib/finance/invoice-draft";
import { readJson, writeJson } from "./store";

/** Locally saved invoice drafts, scoped per data source. Never sent to QuickBooks. */
const SavedSchema = z.object({ id: z.string(), scope: z.string(), savedAt: z.string(), draft: InvoiceDraftSchema });
export type SavedDraft = z.infer<typeof SavedSchema>;
const FILE = "invoice-drafts.json";
const parse = (raw: unknown) => z.array(SavedSchema).parse(raw);

export async function listDrafts(scope: string): Promise<SavedDraft[]> {
  return (await readJson(FILE, parse, [])).filter((d) => d.scope === scope).sort((a, b) => (a.savedAt < b.savedAt ? 1 : -1));
}

export async function saveDraft(scope: string, draft: InvoiceDraft, id?: string): Promise<SavedDraft> {
  const all = await readJson(FILE, parse, []);
  const saved: SavedDraft = { id: id && all.some((d) => d.id === id && d.scope === scope) ? id : randomUUID(), scope, savedAt: new Date().toISOString(), draft: InvoiceDraftSchema.parse(draft) };
  const next = [...all.filter((d) => !(d.id === saved.id && d.scope === scope)), saved].slice(-200);
  await writeJson(FILE, next);
  return saved;
}

export async function deleteDraft(scope: string, id: string): Promise<boolean> {
  const all = await readJson(FILE, parse, []);
  const next = all.filter((d) => !(d.id === id && d.scope === scope));
  if (next.length === all.length) return false;
  await writeJson(FILE, next);
  return true;
}
