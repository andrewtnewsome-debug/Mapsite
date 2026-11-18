import "server-only";

import { z } from "zod";
import { deleteFile, readJson, writeJson } from "@/lib/server/store";
import { decryptJson, encryptJson } from "./crypto";

/** Tokens and connection metadata, encrypted at rest. Never sent to the browser. */
const StoredConnectionSchema = z.object({
  realmId: z.string().min(1),
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  accessTokenExpiresAt: z.string(),
  refreshTokenExpiresAt: z.string().nullable(),
  connectedAt: z.string(),
  lastRefreshedAt: z.string().nullable(),
  environment: z.literal("sandbox"),
});

export type StoredConnection = z.infer<typeof StoredConnectionSchema>;

const FILE = "qbo-connection.enc.json";

export async function loadConnection(): Promise<StoredConnection | null> {
  const blob = await readJson<unknown>(FILE, (raw) => raw, null);
  if (!blob) return null;
  try {
    return StoredConnectionSchema.parse(await decryptJson(blob));
  } catch {
    console.warn("[qbo] Stored connection could not be decrypted or validated; treating as disconnected.");
    return null;
  }
}

export async function saveConnection(conn: StoredConnection): Promise<void> {
  await writeJson(FILE, await encryptJson(StoredConnectionSchema.parse(conn)));
}

export async function clearConnection(): Promise<void> {
  await deleteFile(FILE);
}

/** Non-secret sync status shown in the UI. */
const SyncStateSchema = z.object({
  lastSyncAt: z.string().nullable().default(null),
  lastAttemptAt: z.string().nullable().default(null),
  lastError: z.string().nullable().default(null),
  lastErrorCode: z.string().nullable().default(null),
  companyName: z.string().nullable().default(null),
  realmId: z.string().nullable().default(null),
  counts: z.record(z.string(), z.number()).default({}),
});

export type SyncState = z.infer<typeof SyncStateSchema>;

const EMPTY_SYNC: SyncState = { lastSyncAt: null, lastAttemptAt: null, lastError: null, lastErrorCode: null, companyName: null, realmId: null, counts: {} };

export async function loadSyncState(): Promise<SyncState> {
  return readJson("qbo-sync-state.json", (raw) => SyncStateSchema.parse(raw), EMPTY_SYNC);
}

export async function saveSyncState(patch: Partial<SyncState>): Promise<SyncState> {
  const next = SyncStateSchema.parse({ ...(await loadSyncState()), ...patch });
  await writeJson("qbo-sync-state.json", next);
  return next;
}

export async function clearSyncState(): Promise<void> {
  await deleteFile("qbo-sync-state.json");
}
