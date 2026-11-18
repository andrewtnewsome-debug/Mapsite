import "server-only";

import { z } from "zod";
import { readJson, writeJson } from "./store";

const SettingsSchema = z.object({
  activeSource: z.enum(["demo", "quickbooks-sandbox"]).default("demo"),
  /** Overrides OLLAMA_MODEL when set from the Settings page. */
  ollamaModel: z.string().trim().min(1).max(100).nullable().default(null),
  updatedAt: z.string().nullable().default(null),
});

export type LocalSettings = z.infer<typeof SettingsSchema>;

const DEFAULTS: LocalSettings = { activeSource: "demo", ollamaModel: null, updatedAt: null };

export async function getSettings(): Promise<LocalSettings> {
  return readJson("settings.json", (raw) => SettingsSchema.parse(raw), DEFAULTS);
}

export async function updateSettings(patch: Partial<Omit<LocalSettings, "updatedAt">>): Promise<LocalSettings> {
  const current = await getSettings();
  const next = SettingsSchema.parse({ ...current, ...patch, updatedAt: new Date().toISOString() });
  await writeJson("settings.json", next);
  return next;
}
