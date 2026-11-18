import "server-only";

import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

/**
 * Minimal local JSON file store under `.data/` (git-ignored).
 *
 * Chosen over SQLite so installation on Windows needs no native compiler.
 * Each logical record is one small JSON file written atomically. The
 * repository-style helpers below are the seam for swapping in Postgres when
 * FinanceOS becomes multi-tenant (see PRODUCT_ROADMAP.md).
 */

const SAFE_NAME = /^[a-z0-9][a-z0-9._-]{0,80}$/;

export function dataDir(): string {
  return process.env.FINANCEOS_DATA_DIR || path.join(/*turbopackIgnore: true*/ process.cwd(), ".data");
}

function resolveName(name: string): string {
  if (!SAFE_NAME.test(name) || name.includes("..")) throw new Error("Invalid storage file name");
  return path.join(/*turbopackIgnore: true*/ dataDir(), name);
}

async function ensureDir(): Promise<void> {
  await fs.mkdir(/*turbopackIgnore: true*/ dataDir(), { recursive: true, mode: 0o700 });
}

export async function readJson<T>(name: string, parse: (raw: unknown) => T, fallback: T): Promise<T> {
  try {
    const text = await fs.readFile(/*turbopackIgnore: true*/ resolveName(name), "utf8");
    return parse(JSON.parse(text));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    // Corrupt or invalid file: fall back rather than crash, and surface in logs without contents.
    console.warn(`[store] Could not read ${name}: ${(err as Error).message}`);
    return fallback;
  }
}

export async function writeJson(name: string, value: unknown): Promise<void> {
  await ensureDir();
  const target = resolveName(name);
  const tmp = `${target}.${randomBytes(6).toString("hex")}.tmp`;
  await fs.writeFile(/*turbopackIgnore: true*/ tmp, JSON.stringify(value, null, 2), { encoding: "utf8", mode: 0o600 });
  // Windows can briefly lock files (antivirus, indexer); retry the rename a few times.
  for (let attempt = 0; ; attempt++) {
    try {
      await fs.rename(/*turbopackIgnore: true*/ tmp, target);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (attempt < 4 && (code === "EPERM" || code === "EBUSY" || code === "EACCES")) {
        await new Promise((r) => setTimeout(r, 50 * (attempt + 1)));
        continue;
      }
      await fs.rm(/*turbopackIgnore: true*/ tmp, { force: true });
      throw err;
    }
  }
}

export async function deleteFile(name: string): Promise<void> {
  await fs.rm(/*turbopackIgnore: true*/ resolveName(name), { force: true });
}

export async function appendLine(name: string, line: string): Promise<void> {
  await ensureDir();
  await fs.appendFile(/*turbopackIgnore: true*/ resolveName(name), `${line}\n`, { encoding: "utf8", mode: 0o600 });
}

export async function readLines(name: string, limit = 200): Promise<string[]> {
  try {
    const text = await fs.readFile(/*turbopackIgnore: true*/ resolveName(name), "utf8");
    const lines = text.split(/\r?\n/).filter(Boolean);
    return lines.slice(Math.max(0, lines.length - limit));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}
