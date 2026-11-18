import "server-only";

import { z } from "zod";
import { BudgetSchema, type Budget } from "@/lib/finance/budget";
import { readJson, writeJson } from "./store";

/** One budget per data-source scope (demo, or a QuickBooks company), for the current fiscal year. */
const FileSchema = z.record(z.string(), BudgetSchema);
const FILE = "budgets.json";

export async function loadBudget(scope: string): Promise<Budget | null> {
  const all = await readJson(FILE, (raw) => FileSchema.parse(raw), {});
  return all[scope] ?? null;
}

export async function saveBudget(scope: string, budget: Budget): Promise<void> {
  const all = await readJson(FILE, (raw) => FileSchema.parse(raw), {});
  all[scope] = BudgetSchema.parse(budget);
  await writeJson(FILE, all);
}

export async function deleteBudget(scope: string): Promise<void> {
  const all = await readJson(FILE, (raw) => FileSchema.parse(raw), {});
  delete all[scope];
  await writeJson(FILE, all);
}
