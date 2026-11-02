import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { parseJsonReply } from "@/lib/cim";
import { getSubmission } from "@/lib/db";
import { onePagerPrompt } from "@/lib/onepager";

export const runtime = "nodejs";
export const maxDuration = 120;

function fail(status: number, error: string, message: string) {
  return NextResponse.json({ error, message }, { status });
}

/** Claude writes the one-pager text for a stored deal. The prompt is built here, never taken from the browser. */
export async function POST(req: Request) {
  if (!process.env.ANTHROPIC_API_KEY) return fail(503, "not_configured", "Writing with Claude turns on once Claude is connected (ANTHROPIC_API_KEY).");
  const { id, blind, codeName } = (await req.json().catch(() => ({}))) as { id?: string; blind?: boolean; codeName?: string };
  const s = id ? getSubmission(id) : undefined;
  if (!s) return fail(404, "not_found", "That deal no longer exists.");

  const client = new Anthropic();
  try {
    const response = await client.beta.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 8000,
      output_config: { effort: "medium" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      messages: [{ role: "user", content: onePagerPrompt(s, { blind: !!blind, codeName: String(codeName ?? "").slice(0, 60) }) }],
    });
    if (response.stop_reason === "refusal") return fail(422, "refused", "Claude couldn't write this one-pager. Use the data-built version.");
    const raw = parseJsonReply(response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join(""));
    if (!raw) return fail(502, "unreadable_reply", "Claude's answer couldn't be read. Try again.");
    return NextResponse.json(raw);
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) return fail(429, "rate_limited", "Too many requests to Claude. Try again in a minute.");
    if (error instanceof Anthropic.APIError) return fail(502, "upstream", "Claude is unavailable right now. Try again shortly.");
    throw error;
  }
}
