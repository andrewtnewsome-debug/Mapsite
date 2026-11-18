import { NextResponse } from "next/server";
import { z } from "zod";
import { chatJson, getOllamaStatus, OllamaError } from "@/lib/ai/ollama";
import { addDays, isIsoDate } from "@/lib/domain/dates";
import { customerTerms, newLineId, parseInvoiceRequest } from "@/lib/finance/invoice-draft";
import { resolveOllamaConfig } from "@/lib/server/ai-config";
import { getRequestContext, requirePermission } from "@/lib/server/context";
import { isSameOrigin, jsonError, readJsonBody } from "@/lib/server/http";
import { activeDataset } from "@/lib/server/workspace";

/**
 * Optional local-AI extraction of an invoice description into structured fields.
 * The model only extracts text; quantities and prices are validated here and
 * totals are computed by FinanceOS. Output must reference a known customer.
 */
const Out = z.object({
  customer: z.string().max(200).optional().default(""),
  lines: z.array(z.object({ description: z.string().max(300), quantity: z.number().finite().min(0).max(1e6), unitPrice: z.number().finite().min(0).max(1e9) })).max(50).default([]),
  dueInDays: z.number().int().min(0).max(365).nullable().optional(),
  dueDate: z.string().nullable().optional(),
});

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return jsonError(403, "Cross-origin request rejected.");
  requirePermission(getRequestContext(), "draft:invoices");
  const body = z.object({ text: z.string().trim().min(3).max(2000), today: z.string().refine(isIsoDate) }).safeParse(await readJsonBody(request));
  if (!body.success) return jsonError(400, "Describe the invoice in a sentence or two.");
  const { dataset } = await activeDataset();
  if (!dataset) return jsonError(409, "No data source is loaded.");
  const { config, error } = await resolveOllamaConfig();
  if (!config) return jsonError(400, error ?? "Ollama is not configured.");
  const status = await getOllamaStatus(config);
  if (!status.running) return jsonError(503, "Ollama is not running. The rule-based parser still works; start Ollama to use AI parsing.");
  if (!status.modelInstalled) return jsonError(503, `The model "${config.model}" is not installed. Run: ollama pull ${config.model}`);
  const terms = customerTerms(dataset.invoices);
  const customers = dataset.customers.filter((c) => c.active).map((c) => ({ id: c.id, name: c.name, termsDays: terms.get(c.id) ?? null }));
  try {
    const raw = await chatJson<unknown>(
      config,
      [
        { role: "system", content: `Extract an invoice from the user's text. Use the customer name exactly as written by the user. For each line give description, quantity and unit price (price per unit, not the line total). Do not invent items or prices. If a due date or payment terms are given, return dueInDays or dueDate (YYYY-MM-DD). Known customers: ${customers.slice(0, 200).map((c) => c.name).join("; ")}.` },
        { role: "user", content: body.data.text },
      ],
      { type: "object", properties: { customer: { type: "string" }, lines: { type: "array", items: { type: "object", properties: { description: { type: "string" }, quantity: { type: "number" }, unitPrice: { type: "number" } }, required: ["description", "quantity", "unitPrice"] } }, dueInDays: { type: ["integer", "null"] }, dueDate: { type: ["string", "null"] } }, required: ["customer", "lines"] },
    );
    const out = Out.safeParse(raw);
    if (!out.success) return jsonError(502, "The local model returned an invoice that did not pass validation.");
    // Customer must match a known customer; reuse the deterministic matcher.
    const base = parseInvoiceRequest(`${out.data.customer} ${body.data.text}`, customers, body.data.today);
    const lines = out.data.lines.filter((l) => l.description.trim()).map((l) => ({ id: newLineId(), description: l.description.trim(), quantity: l.quantity, unitPrice: Math.round(l.unitPrice * 100) / 100 }));
    const dueDate = out.data.dueDate && isIsoDate(out.data.dueDate) && out.data.dueDate >= body.data.today ? out.data.dueDate : out.data.dueInDays != null ? addDays(body.data.today, out.data.dueInDays) : base.draft.dueDate;
    const warnings = base.warnings.filter((w) => !w.startsWith("No line items"));
    // Prices the user never typed are flagged so the owner checks them.
    const typed = new Set((body.data.text.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((n) => Number(n.replace(/,/g, ""))));
    for (const l of lines) if (!typed.has(l.unitPrice) && !typed.has(Math.round(l.unitPrice * l.quantity * 100) / 100)) warnings.push(`Check the price for "${l.description}": ${l.unitPrice} was not written in your description.`);
    return NextResponse.json({ ok: true, model: config.model, result: { draft: { ...base.draft, lines: lines.length ? lines : base.draft.lines, dueDate }, warnings } });
  } catch (err) {
    return jsonError(502, err instanceof OllamaError ? err.message : "AI parsing failed.");
  }
}
