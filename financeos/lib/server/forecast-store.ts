import "server-only";

import { z } from "zod";
import type { FinancialDataset } from "@/lib/domain/types";
import type { ForecastAssumptions } from "@/lib/finance/forecast";
import { ForecastAssumptionsSchema } from "@/lib/finance/forecast-schema";
import { readJson, writeJson } from "./store";

/** Saved forecast assumptions, kept separately per data source (and per QuickBooks company). */
const FileSchema = z.record(z.string(), z.object({ savedAt: z.string(), assumptions: ForecastAssumptionsSchema }));

export function forecastKey(ds: Pick<FinancialDataset, "source" | "company">): string {
  return ds.source === "demo" ? "demo" : `qbo:${ds.company.realmId ?? "unknown"}`;
}

export async function loadSavedAssumptions(key: string): Promise<{ savedAt: string; assumptions: ForecastAssumptions } | null> {
  const all = await readJson("forecast-assumptions.json", (raw) => FileSchema.parse(raw), {});
  return all[key] ?? null;
}

export async function saveAssumptions(key: string, assumptions: ForecastAssumptions): Promise<string> {
  const all = await readJson("forecast-assumptions.json", (raw) => FileSchema.parse(raw), {});
  const savedAt = new Date().toISOString();
  all[key] = { savedAt, assumptions: ForecastAssumptionsSchema.parse(assumptions) };
  await writeJson("forecast-assumptions.json", all);
  return savedAt;
}

export async function deleteSavedAssumptions(key: string): Promise<void> {
  const all = await readJson("forecast-assumptions.json", (raw) => FileSchema.parse(raw), {});
  delete all[key];
  await writeJson("forecast-assumptions.json", all);
}
