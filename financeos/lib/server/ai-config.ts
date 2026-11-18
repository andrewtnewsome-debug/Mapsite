import "server-only";

import { OllamaError, validateOllamaConfig, type OllamaConfig } from "@/lib/ai/ollama";
import { getSettings } from "./settings";

export async function resolveOllamaConfig(): Promise<{ config: OllamaConfig | null; error: string | null }> {
  const settings = await getSettings();
  try {
    return {
      config: validateOllamaConfig({ baseUrl: process.env.OLLAMA_BASE_URL, model: settings.ollamaModel ?? process.env.OLLAMA_MODEL, timeoutSeconds: process.env.OLLAMA_TIMEOUT_SECONDS }),
      error: null,
    };
  } catch (err) {
    return { config: null, error: err instanceof OllamaError ? err.message : "Invalid Ollama configuration." };
  }
}
