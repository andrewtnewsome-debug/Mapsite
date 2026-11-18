import "server-only";

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { dataDir } from "@/lib/server/store";

/**
 * AES-256-GCM encryption for tokens at rest in `.data/`.
 *
 * Key source, in order: FINANCEOS_ENCRYPTION_KEY (64 hex chars), otherwise a
 * random key generated once into `.data/secret.key`. This protects against
 * casual disclosure (e.g. a copied data file) but NOT against someone with
 * full access to this computer account. See PRODUCT_ROADMAP.md for the
 * production approach (managed KMS).
 */

interface EncryptedBlob {
  v: 1;
  iv: string;
  tag: string;
  data: string;
}

let cachedKey: Buffer | null = null;

async function getKey(): Promise<Buffer> {
  if (cachedKey) return cachedKey;
  const fromEnv = process.env.FINANCEOS_ENCRYPTION_KEY?.trim();
  if (fromEnv) {
    if (!/^[0-9a-fA-F]{64}$/.test(fromEnv)) throw new Error("FINANCEOS_ENCRYPTION_KEY must be 64 hexadecimal characters");
    cachedKey = Buffer.from(fromEnv, "hex");
    return cachedKey;
  }
  const keyPath = path.join(dataDir(), "secret.key");
  try {
    const hex = (await fs.readFile(keyPath, "utf8")).trim();
    if (/^[0-9a-f]{64}$/.test(hex)) {
      cachedKey = Buffer.from(hex, "hex");
      return cachedKey;
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  await fs.mkdir(dataDir(), { recursive: true, mode: 0o700 });
  const key = randomBytes(32);
  await fs.writeFile(keyPath, key.toString("hex"), { encoding: "utf8", mode: 0o600, flag: "wx" }).catch(async (err) => {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
  });
  const hex = (await fs.readFile(keyPath, "utf8")).trim();
  cachedKey = Buffer.from(hex, "hex");
  return cachedKey;
}

export function resetKeyCacheForTests(): void {
  cachedKey = null;
}

export async function encryptJson(value: unknown): Promise<EncryptedBlob> {
  const key = await getKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return { v: 1, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: data.toString("base64") };
}

export async function decryptJson<T>(blob: unknown): Promise<T> {
  const b = blob as EncryptedBlob;
  if (!b || b.v !== 1 || typeof b.iv !== "string" || typeof b.tag !== "string" || typeof b.data !== "string") {
    throw new Error("Unrecognized encrypted payload");
  }
  const key = await getKey();
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(b.iv, "base64"));
  decipher.setAuthTag(Buffer.from(b.tag, "base64"));
  const text = Buffer.concat([decipher.update(Buffer.from(b.data, "base64")), decipher.final()]).toString("utf8");
  return JSON.parse(text) as T;
}

/** Derives a purpose-specific secret (e.g. for signing OAuth state) from the encryption key. */
export async function deriveSecret(purpose: string): Promise<Buffer> {
  const { createHmac } = await import("node:crypto");
  return createHmac("sha256", await getKey()).update(`financeos:${purpose}`).digest();
}
