import { NextResponse } from "next/server";
import { z } from "zod";
import { verifyAnswer } from "@/lib/ai/guard";
import { chatJson, getOllamaStatus, OllamaError } from "@/lib/ai/ollama";
import { resolveOllamaConfig } from "@/lib/server/ai-config";
import { getRequestContext, requirePermission } from "@/lib/server/context";
import { isSameOrigin, jsonError, readJsonBody } from "@/lib/server/http";

/**
 * Optional: polish a collections email with the local model. The original
 * draft (with verified invoice numbers and amounts) is the only source of
 * figures; any figure in the rewrite that is not in the original is flagged.
 */
const Body = z.object({ subject: z.string().max(300), body: z.string().min(1).max(10_000), instruction: z.string().max(300).optional() });

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return jsonError(403, "Cross-origin request rejected.");
  requirePermission(getRequestContext(), "use:ai");
  const parsed = Body.safeParse(await readJsonBody(request));
  if (!parsed.success) return jsonError(400, "Invalid draft.");
  const { config, error } = await resolveOllamaConfig();
  if (!config) return jsonError(400, error ?? "Ollama is not configured.");
  const status = await getOllamaStatus(config);
  if (!status.running) return jsonError(503, "Ollama is not running. Start Ollama to polish drafts with AI; the template draft is ready to use as is.");
  if (!status.modelInstalled) return jsonError(503, `The model "${config.model}" is not installed. Run: ollama pull ${config.model}`);
  try {
    const out = await chatJson<{ subject?: string; body?: string }>(
      config,
      [
        {
          role: "system",
          content:
            "You edit business emails. Improve clarity and professional tone while keeping every invoice number, date and amount exactly as written. Do not add new facts, amounts, dates, threats or legal claims. Keep the bullet list of invoices. Keep placeholders like [Your name]. Reply with JSON {\"subject\":..., \"body\":...}.",
        },
        { role: "user", content: `${parsed.data.instruction ? `Instruction: ${parsed.data.instruction}\n\n` : ""}SUBJECT: ${parsed.data.subject}\n\nBODY:\n${parsed.data.body}` },
      ],
      { type: "object", properties: { subject: { type: "string" }, body: { type: "string" } }, required: ["subject", "body"] },
    );
    if (!out.body || !out.subject) return jsonError(502, "The local model did not return a usable draft.");
    const original = [{ toolId: "collections_priorities" as const, title: "draft", asOfDate: "", source: "", facts: [], assumptions: [], notes: [], summary: `${parsed.data.subject}\n${parsed.data.body}`, available: true }];
    const v = verifyAnswer(`${out.subject}\n${out.body}`, original);
    return NextResponse.json({ ok: true, subject: out.subject.slice(0, 300), body: out.body.slice(0, 10_000), unverified: v.unverified, model: config.model });
  } catch (err) {
    return jsonError(502, err instanceof OllamaError ? err.message : "The local model failed.");
  }
}
