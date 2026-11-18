"use client";

import * as React from "react";
import { Bot, ClipboardCopy, Download, FileText, Plus, Save, Trash2, Wand2 } from "lucide-react";
import { formatIsoDate } from "@/lib/domain/dates";
import { computeInvoiceTotals, newLineId, parseInvoiceRequest, type CustomerOption, type InvoiceDraft } from "@/lib/finance/invoice-draft";
import { toCsv } from "@/lib/csv";
import { formatCurrency } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Notice } from "@/components/ui/states";
import { Spinner } from "@/components/ui/spinner";

interface SavedDraft {
  id: string;
  savedAt: string;
  draft: InvoiceDraft;
}

const EXAMPLES = [
  "Bill Granite Peak Properties for 3 carpet extractions at $450 each and 6 hours of HVAC repair at $95/hour, net 30",
  "Invoice Bluewater for two filter replacements at $85, $1,250 for emergency boiler service; due December 15",
  "Charge Meridian Tech Campus $3,400 for LED lighting retrofit, due in 15 days",
];

export function InvoiceAssistant({ customers, today, companyName }: { customers: CustomerOption[]; today: string; companyName: string }) {
  const [text, setText] = React.useState("");
  const [draft, setDraft] = React.useState<InvoiceDraft | null>(null);
  const [draftId, setDraftId] = React.useState<string | undefined>();
  const [warnings, setWarnings] = React.useState<string[]>([]);
  const [parsedBy, setParsedBy] = React.useState<string | null>(null);
  const [aiState, setAiState] = React.useState<{ loading: boolean; error: string | null }>({ loading: false, error: null });
  const [saved, setSaved] = React.useState<SavedDraft[]>([]);
  const [saveMsg, setSaveMsg] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    const res = await fetch("/api/invoices/drafts");
    if (res.ok) setSaved(((await res.json()) as { drafts: SavedDraft[] }).drafts);
  }, []);
  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial load of saved drafts
    void load();
  }, [load]);

  function prepare() {
    const r = parseInvoiceRequest(text, customers, today);
    setDraft(r.draft);
    setDraftId(undefined);
    setWarnings(r.warnings);
    setParsedBy("rules");
    setSaveMsg(null);
  }

  async function prepareWithAi() {
    setAiState({ loading: true, error: null });
    const res = await fetch("/api/invoices/parse-ai", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, today }) });
    const data = (await res.json()) as { ok: boolean; error?: string; model?: string; result?: { draft: InvoiceDraft; warnings: string[] } };
    if (!res.ok || !data.ok || !data.result) return setAiState({ loading: false, error: data.error ?? "AI parsing failed." });
    setDraft(data.result.draft);
    setDraftId(undefined);
    setWarnings(data.result.warnings);
    setParsedBy(`local AI (${data.model})`);
    setAiState({ loading: false, error: null });
  }

  const totals = draft ? computeInvoiceTotals(draft) : null;
  const set = (patch: Partial<InvoiceDraft>) => setDraft((d) => (d ? { ...d, ...patch } : d));
  const setLine = (id: string, patch: Partial<InvoiceDraft["lines"][number]>) => setDraft((d) => (d ? { ...d, lines: d.lines.map((l) => (l.id === id ? { ...l, ...patch } : l)) } : d));
  const num = (v: string) => {
    const n = Number(v.replace(/[,$\s]/g, ""));
    return Number.isFinite(n) ? n : 0;
  };

  function asText(): string {
    if (!draft || !totals) return "";
    return [
      `DRAFT INVOICE - ${companyName}`,
      `Bill to: ${draft.customerName || "(customer)"}`,
      `Invoice date: ${formatIsoDate(draft.invoiceDate)}    Due: ${formatIsoDate(draft.dueDate)} (${draft.terms})`,
      "",
      ...totals.lines.map((l) => `${l.description} - ${l.quantity} x ${formatCurrency(l.unitPrice, { cents: true })} = ${formatCurrency(l.amount, { cents: true })}`),
      "",
      `Total: ${formatCurrency(totals.total, { cents: true })}`,
      draft.memo ? `\nNote: ${draft.memo}` : "",
      "\nDraft only. Not created in QuickBooks.",
    ].join("\n");
  }

  function downloadCsv() {
    if (!draft || !totals) return;
    const csv = toCsv(
      ["Customer", "Invoice date", "Due date", "Terms", "Description", "Quantity", "Unit price", "Amount"],
      totals.lines.map((l) => [draft.customerName, draft.invoiceDate, draft.dueDate, draft.terms, l.description, l.quantity, l.unitPrice, l.amount]),
      [`Draft invoice - ${companyName}`, "Draft only. Not created in QuickBooks.", ""],
    );
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `invoice-draft-${(draft.customerName || "customer").replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-${draft.invoiceDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function save() {
    if (!draft) return;
    const res = await fetch("/api/invoices/drafts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: draftId, draft: { ...draft, lines: draft.lines.filter((l) => l.description.trim()) } }) });
    const data = (await res.json()) as { ok: boolean; error?: string; saved?: SavedDraft };
    if (!res.ok || !data.saved) return setSaveMsg(data.error ?? "Could not save.");
    setDraftId(data.saved.id);
    setSaveMsg("Saved on this computer.");
    await load();
  }

  async function remove(id: string) {
    await fetch("/api/invoices/drafts", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
    if (id === draftId) setDraftId(undefined);
    await load();
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Describe the invoice</CardTitle>
            <CardDescription>Who it is for, what you did, quantities, prices and when it is due.</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <label htmlFor="invoice-text" className="sr-only">Invoice description</label>
          <Textarea id="invoice-text" rows={3} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} placeholder={EXAMPLES[0]} />
          <div className="flex flex-wrap gap-2">
            {EXAMPLES.map((ex) => (
              <button key={ex} type="button" onClick={() => setText(ex)} className="max-w-full truncate rounded-full border border-border px-3 py-1 text-[12px] text-text-2 hover:border-border-strong hover:text-text">
                {ex}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" onClick={prepare} disabled={text.trim().length < 3}>
              <Wand2 /> Prepare draft
            </Button>
            <Button onClick={prepareWithAi} disabled={text.trim().length < 3 || aiState.loading}>
              {aiState.loading ? <Spinner label="Parsing" /> : <Bot />} Prepare with local AI
            </Button>
          </div>
          {aiState.error ? <Notice tone="warning">{aiState.error}</Notice> : null}
        </CardContent>
      </Card>

      {draft && totals ? (
        <Card>
          <CardHeader>
            <div>
              <CardTitle className="flex items-center gap-2">
                <FileText className="size-4" aria-hidden /> Draft invoice
              </CardTitle>
              <CardDescription>Edit anything below. Totals are calculated by FinanceOS. This draft is not created in QuickBooks.</CardDescription>
            </div>
            {parsedBy ? <Badge tone={parsedBy.startsWith("local AI") ? "accent" : "neutral"}>Parsed by {parsedBy}</Badge> : null}
          </CardHeader>
          <CardContent className="space-y-4">
            {warnings.length ? (
              <Notice tone="warning" title="Please check">
                <ul className="list-disc pl-5">
                  {warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              </Notice>
            ) : null}
            <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
              <div className="md:col-span-2">
                <label htmlFor="inv-customer" className="mb-1 block text-[12px] font-medium text-text-3">Customer</label>
                <Select
                  id="inv-customer"
                  value={draft.customerId ?? ""}
                  onChange={(e) => {
                    const c = customers.find((x) => x.id === e.target.value);
                    set({ customerId: c?.id ?? null, customerName: c?.name ?? draft.customerName });
                  }}
                >
                  <option value="">Choose a customer…</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </Select>
              </div>
              <div>
                <label htmlFor="inv-date" className="mb-1 block text-[12px] font-medium text-text-3">Invoice date</label>
                <Input id="inv-date" type="date" value={draft.invoiceDate} onChange={(e) => e.target.value && set({ invoiceDate: e.target.value })} />
              </div>
              <div>
                <label htmlFor="inv-due" className="mb-1 block text-[12px] font-medium text-text-3">Due date ({draft.terms})</label>
                <Input id="inv-due" type="date" value={draft.dueDate} onChange={(e) => e.target.value && set({ dueDate: e.target.value, terms: "Custom" })} />
              </div>
            </div>

            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-[640px] text-[13px]">
                <thead className="bg-surface-2/60">
                  <tr>
                    <th scope="col" className="px-3 py-2 text-left text-[12px] font-medium text-text-3">Description</th>
                    <th scope="col" className="w-24 px-3 py-2 text-right text-[12px] font-medium text-text-3">Quantity</th>
                    <th scope="col" className="w-32 px-3 py-2 text-right text-[12px] font-medium text-text-3">Unit price</th>
                    <th scope="col" className="w-32 px-3 py-2 text-right text-[12px] font-medium text-text-3">Amount</th>
                    <th scope="col" className="w-10"><span className="sr-only">Remove</span></th>
                  </tr>
                </thead>
                <tbody>
                  {totals.lines.map((l, i) => (
                    <tr key={l.id} className="border-t border-border">
                      <td className="px-2 py-1.5">
                        <Input aria-label={`Line ${i + 1} description`} value={l.description} maxLength={300} onChange={(e) => setLine(l.id, { description: e.target.value })} />
                      </td>
                      <td className="px-2 py-1.5">
                        <Input aria-label={`Line ${i + 1} quantity`} inputMode="decimal" className="tabular text-right" defaultValue={String(l.quantity)} key={`q-${l.id}-${l.quantity}`} onBlur={(e) => setLine(l.id, { quantity: Math.max(0, num(e.target.value)) })} />
                      </td>
                      <td className="px-2 py-1.5">
                        <Input aria-label={`Line ${i + 1} unit price`} inputMode="decimal" className="tabular text-right" defaultValue={String(l.unitPrice)} key={`p-${l.id}-${l.unitPrice}`} onBlur={(e) => setLine(l.id, { unitPrice: num(e.target.value) })} />
                      </td>
                      <td className="tabular px-3 py-1.5 text-right font-medium">{formatCurrency(l.amount, { cents: true })}</td>
                      <td className="px-1">
                        <button type="button" aria-label={`Remove line ${i + 1}`} disabled={draft.lines.length === 1} onClick={() => set({ lines: draft.lines.filter((x) => x.id !== l.id) })} className="inline-flex size-8 items-center justify-center rounded-md text-text-3 hover:bg-surface-2 hover:text-critical-text disabled:opacity-30">
                          <Trash2 className="size-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-border bg-surface-2/40">
                    <td className="px-3 py-2">
                      <Button size="sm" variant="ghost" onClick={() => set({ lines: [...draft.lines, { id: newLineId(), description: "", quantity: 1, unitPrice: 0 }] })}>
                        <Plus /> Add line
                      </Button>
                    </td>
                    <td colSpan={2} className="px-3 py-2 text-right font-semibold">Total</td>
                    <td className="tabular px-3 py-2 text-right text-[15px] font-semibold">{formatCurrency(totals.total, { cents: true })}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
            <div>
              <label htmlFor="inv-memo" className="mb-1 block text-[12px] font-medium text-text-3">Note to customer (optional)</label>
              <Input id="inv-memo" value={draft.memo} maxLength={1000} onChange={(e) => set({ memo: e.target.value })} />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="primary" onClick={save}>
                <Save /> Save draft
              </Button>
              <Button onClick={() => navigator.clipboard?.writeText(asText())}>
                <ClipboardCopy /> Copy as text
              </Button>
              <Button onClick={downloadCsv}>
                <Download /> Download CSV
              </Button>
              {saveMsg ? <span className="text-[12px] text-text-3" aria-live="polite">{saveMsg}</span> : null}
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Saved drafts</CardTitle>
            <CardDescription>Stored on this computer for the current data source.</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="px-0 pb-2">
          {saved.length === 0 ? (
            <p className="px-5 pb-3 text-[13px] text-text-3">No saved drafts yet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {saved.map((s) => {
                const t = computeInvoiceTotals(s.draft);
                return (
                  <li key={s.id} className="flex flex-wrap items-center gap-3 px-5 py-2.5 text-[13px]">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{s.draft.customerName || "No customer"} · <span className="tabular">{formatCurrency(t.total, { cents: true })}</span></p>
                      <p className="text-[12px] text-text-3">{s.draft.lines.length} line{s.draft.lines.length === 1 ? "" : "s"} · due {formatIsoDate(s.draft.dueDate)} · saved {new Date(s.savedAt).toLocaleString()}</p>
                    </div>
                    <Button size="sm" onClick={() => { setDraft(s.draft); setDraftId(s.id); setWarnings([]); setParsedBy(null); }}>Open</Button>
                    <button type="button" aria-label="Delete draft" onClick={() => remove(s.id)} className="inline-flex size-8 items-center justify-center rounded-md text-text-3 hover:bg-surface-2 hover:text-critical-text">
                      <Trash2 className="size-4" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
