import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { CIM_INSTRUCTIONS, normalizeCim, parseJsonReply } from "@/lib/cim";

export const runtime = "nodejs";
// Reading a long CIM can take a few minutes.
export const maxDuration = 300;

const MAX_BYTES = 30 * 1024 * 1024;

function fail(status: number, error: string, message: string) {
  return NextResponse.json({ error, message }, { status });
}

/** Reads an uploaded CIM (PDF) with Claude and returns the extracted fields. */
export async function POST(req: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return fail(503, "not_configured", "CIM reading turns on once Claude is connected (ANTHROPIC_API_KEY). Fill in the form by hand for now.");
  }

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return fail(400, "no_file", "Choose a PDF to upload.");
  if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
    return fail(415, "not_pdf", "Upload the CIM as a PDF. Save Word or PowerPoint files as PDF first.");
  }
  if (file.size > MAX_BYTES) return fail(413, "too_large", "That file is over 30 MB. Upload a smaller copy of the CIM.");

  const data = Buffer.from(await file.arrayBuffer()).toString("base64");
  const client = new Anthropic();

  try {
    const response = await client.beta.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 16000,
      output_config: { effort: "medium" },
      // If a safety classifier declines, retry on Anthropic's recommended fallback model.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      messages: [
        {
          role: "user",
          content: [
            { type: "document", source: { type: "base64", media_type: "application/pdf", data } },
            { type: "text", text: CIM_INSTRUCTIONS },
          ],
        },
      ],
    });

    if (response.stop_reason === "refusal") {
      return fail(422, "refused", "Claude couldn't read this document. Fill in the form by hand.");
    }
    const text = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    const raw = parseJsonReply(text);
    if (!raw) return fail(502, "unreadable_reply", "Claude's answer couldn't be read. Try the upload again.");
    return NextResponse.json(normalizeCim(raw, { fileName: file.name }));
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) return fail(429, "rate_limited", "Too many CIMs at once. Try again in a minute.");
    if (error instanceof Anthropic.BadRequestError) return fail(400, "bad_request", "Claude couldn't open this PDF. It may be encrypted or damaged.");
    if (error instanceof Anthropic.AuthenticationError) return fail(500, "auth", "The Claude API key is not valid. Check ANTHROPIC_API_KEY.");
    if (error instanceof Anthropic.APIError) return fail(502, "upstream", "Claude is unavailable right now. Try again shortly.");
    throw error;
  }
}
