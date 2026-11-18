import "server-only";

import type { FinancialDataset } from "@/lib/domain/types";
import { deleteFile, readJson, writeJson } from "@/lib/server/store";
import { encryptJson, decryptJson } from "./crypto";

/**
 * The last successfully synced QuickBooks Sandbox dataset, mapped to the
 * canonical model and encrypted at rest. The app reads from this snapshot so
 * pages load instantly and never mix with demo data.
 */
const FILE = "qbo-snapshot.enc.json";

export async function loadQboSnapshot(): Promise<FinancialDataset | null> {
  const blob = await readJson<unknown>(FILE, (raw) => raw, null);
  if (!blob) return null;
  try {
    const ds = await decryptJson<FinancialDataset>(blob);
    if (ds?.source !== "quickbooks-sandbox") return null;
    return ds;
  } catch {
    console.warn("[qbo] Snapshot could not be decrypted; a new sync is required.");
    return null;
  }
}

export async function saveQboSnapshot(dataset: FinancialDataset): Promise<void> {
  if (dataset.source !== "quickbooks-sandbox") throw new Error("Only QuickBooks Sandbox datasets can be stored as a snapshot");
  await writeJson(FILE, await encryptJson(dataset));
}

export async function clearQboSnapshot(): Promise<void> {
  await deleteFile(FILE);
}
