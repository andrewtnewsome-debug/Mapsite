import "server-only";

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { readJson, writeJson } from "./store";

/**
 * Locally stored collection follow-ups. Each list is scoped to a data source
 * key (demo, or a QuickBooks company) so lists never mix between companies.
 * Approving a follow-up records the owner's decision; FinanceOS never sends email.
 */
export const FollowUpStatusSchema = z.enum(["proposed", "approved", "done", "dismissed"]);

export const FollowUpSchema = z.object({
  id: z.string(),
  scope: z.string(),
  customerId: z.string().max(60),
  customerName: z.string().max(200),
  invoiceNumbers: z.array(z.string().max(40)).max(50),
  amount: z.number().finite(),
  action: z.string().trim().min(1).max(300),
  followUpDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  status: FollowUpStatusSchema,
  subject: z.string().max(300),
  body: z.string().max(10_000),
  notes: z.string().max(2000).default(""),
  createdAt: z.string(),
  updatedAt: z.string(),
  approvedAt: z.string().nullable().default(null),
});

export type FollowUp = z.infer<typeof FollowUpSchema>;

const FILE = "followups.json";
const parse = (raw: unknown) => z.array(FollowUpSchema).parse(raw);

export async function listFollowUps(scope: string): Promise<FollowUp[]> {
  const all = await readJson(FILE, parse, []);
  return all.filter((f) => f.scope === scope).sort((a, b) => (a.followUpDate < b.followUpDate ? -1 : 1));
}

export const NewFollowUpSchema = FollowUpSchema.pick({ customerId: true, customerName: true, invoiceNumbers: true, amount: true, action: true, followUpDate: true, subject: true, body: true }).extend({ notes: z.string().max(2000).optional() });

export async function createFollowUp(scope: string, input: z.infer<typeof NewFollowUpSchema>): Promise<FollowUp> {
  const all = await readJson(FILE, parse, []);
  const now = new Date().toISOString();
  const f: FollowUp = FollowUpSchema.parse({ ...input, notes: input.notes ?? "", id: randomUUID(), scope, status: "proposed", createdAt: now, updatedAt: now, approvedAt: null });
  all.push(f);
  await writeJson(FILE, all);
  return f;
}

export const UpdateFollowUpSchema = z.object({
  id: z.string().uuid(),
  status: FollowUpStatusSchema.optional(),
  notes: z.string().max(2000).optional(),
  subject: z.string().max(300).optional(),
  body: z.string().max(10_000).optional(),
  followUpDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export async function updateFollowUp(scope: string, patch: z.infer<typeof UpdateFollowUpSchema>): Promise<FollowUp | null> {
  const all = await readJson(FILE, parse, []);
  const idx = all.findIndex((f) => f.id === patch.id && f.scope === scope);
  if (idx < 0) return null;
  const now = new Date().toISOString();
  const next = FollowUpSchema.parse({ ...all[idx], ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)), updatedAt: now, approvedAt: patch.status === "approved" ? now : all[idx].approvedAt });
  all[idx] = next;
  await writeJson(FILE, all);
  return next;
}

export async function deleteFollowUp(scope: string, id: string): Promise<boolean> {
  const all = await readJson(FILE, parse, []);
  const next = all.filter((f) => !(f.id === id && f.scope === scope));
  if (next.length === all.length) return false;
  await writeJson(FILE, next);
  return true;
}
