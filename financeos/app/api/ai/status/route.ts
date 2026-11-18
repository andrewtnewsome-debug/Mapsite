import { NextResponse } from "next/server";
import { getOllamaStatus } from "@/lib/ai/ollama";
import { resolveOllamaConfig } from "@/lib/server/ai-config";

export async function GET() {
  const { config, error } = await resolveOllamaConfig();
  if (!config) return NextResponse.json({ running: false, configError: error, models: [], model: null, modelInstalled: false });
  const status = await getOllamaStatus(config);
  return NextResponse.json({ ...status, configError: null });
}
