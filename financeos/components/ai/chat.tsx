"use client";

import * as React from "react";
import { AlertTriangle, ArrowUp, Bot, Calculator, CheckCircle2, ChevronRight, Square, Trash2 } from "lucide-react";
import type { ChatEvent, AnswerMode } from "@/lib/ai/answer";
import type { Verification } from "@/lib/ai/guard";
import type { ToolCall, ToolResult } from "@/lib/ai/tools";
import { formatIsoDate } from "@/lib/domain/dates";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/states";
import { Spinner } from "@/components/ui/spinner";
import { Markdown } from "./markdown";
import { errorMessage, readNdjson } from "./stream";

interface UserMsg {
  id: string;
  role: "user";
  content: string;
}

interface AssistantMsg {
  id: string;
  role: "assistant";
  content: string;
  status: "streaming" | "done" | "error";
  mode: AnswerMode | null;
  model: string | null;
  calls: ToolCall[];
  results: ToolResult[];
  verification: Verification | null;
  followUps: string[];
  notice: string | null;
  error: string | null;
  routing: string | null;
  statusText: string | null;
}

type Msg = UserMsg | AssistantMsg;

const STORAGE_KEY = "financeos.aiCfo.conversation.v1";

function newId() {
  return Math.random().toString(36).slice(2, 10);
}

const BASIS_BADGE = {
  fact: { label: "Recorded", tone: "neutral" as const },
  forecast: { label: "Forecast", tone: "accent" as const },
  assumption: { label: "Assumption", tone: "warning" as const },
};

function DataUsed({ results }: { results: ToolResult[] }) {
  if (results.length === 0) return null;
  return (
    <details className="group mt-3 rounded-lg border border-border">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-[12px] font-medium text-text-2 hover:bg-surface-2/60">
        <ChevronRight className="size-3.5 transition-transform group-open:rotate-90" aria-hidden />
        Verified data used ({results.length} calculation{results.length === 1 ? "" : "s"})
      </summary>
      <div className="space-y-4 border-t border-border px-3 py-3">
        {results.map((r, i) => (
          <div key={`${r.toolId}-${i}`}>
            <p className="text-[13px] font-medium text-text">{r.title}</p>
            <p className="text-[11px] text-text-3">
              As of {formatIsoDate(r.asOfDate)} · Source: {r.source}
            </p>
            {!r.available ? <p className="mt-1 text-[12px] text-warning-text">Not available: {r.notes.join(" ")}</p> : null}
            {r.facts.length ? (
              <table className="mt-2 w-full text-[12px]">
                <tbody>
                  {r.facts.slice(0, 40).map((f, fi) => (
                    <tr key={fi} className="border-t border-border/70 first:border-0">
                      <td className="py-1 pr-2 text-text-2">{f.label}</td>
                      <td className="tabular py-1 pr-2 text-right font-medium text-text">{f.display}</td>
                      <td className="w-20 py-1 text-right">
                        <Badge tone={BASIS_BADGE[f.basis].tone}>{BASIS_BADGE[f.basis].label}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
            {r.table && r.table.rows.length ? (
              <div className="mt-2 overflow-x-auto rounded-md border border-border">
                <table className="w-full text-[12px]">
                  <thead className="bg-surface-2">
                    <tr>
                      {r.table.columns.map((c) => (
                        <th key={c} scope="col" className="px-2 py-1 text-left font-medium text-text-3">{c}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {r.table.rows.map((row, ri) => (
                      <tr key={ri} className="border-t border-border">
                        {row.map((cell, ci) => (
                          <td key={ci} className="tabular px-2 py-1 text-text-2">{cell}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
            {r.assumptions.length ? (
              <ul className="mt-2 list-disc space-y-0.5 pl-4 text-[11px] text-text-3">
                {r.assumptions.map((a, ai) => (
                  <li key={ai}>Assumption: {a}</li>
                ))}
              </ul>
            ) : null}
            {r.notes.length && r.available ? <p className="mt-1 text-[11px] text-text-3">{r.notes.join(" ")}</p> : null}
          </div>
        ))}
      </div>
    </details>
  );
}

function Elapsed() {
  const [s, setS] = React.useState(0);
  React.useEffect(() => {
    const t = setInterval(() => setS((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, []);
  return <span className="tabular">{s}s</span>;
}

function AssistantBubble({ m, onAsk }: { m: AssistantMsg; onAsk: (q: string) => void }) {
  return (
    <div className="flex gap-3">
      <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-fg" aria-hidden>
        <Bot className="size-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="mb-1.5 flex flex-wrap items-center gap-2">
          <span className="text-[13px] font-semibold">AI CFO</span>
          {m.mode === "ai" ? (
            <Badge tone="accent">
              <Bot aria-hidden /> Local AI{m.model ? ` · ${m.model}` : ""}
            </Badge>
          ) : m.mode === "deterministic" ? (
            <Badge>
              <Calculator aria-hidden /> Calculated answer (no AI)
            </Badge>
          ) : null}
        </div>
        {m.notice ? <Notice tone="warning" className="mb-2">{m.notice}</Notice> : null}
        {m.error ? <Notice tone="critical" className="mb-2">{m.error}</Notice> : null}
        <div className="text-[14px] text-text">
          {m.content ? (
            <Markdown text={m.content} />
          ) : m.status === "streaming" ? (
            <span className="inline-flex items-center gap-2 text-[13px] text-text-3">
              <Spinner label="Working on it" />
              <span>
                {m.statusText ?? (m.mode === "ai" ? "Waiting for the local model…" : "Calculating…")} <Elapsed />
              </span>
            </span>
          ) : null}
          {m.status === "streaming" && m.content ? <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-text-3 align-middle" aria-hidden /> : null}
        </div>
        {m.status === "done" && m.mode === "ai" && m.verification ? (
          m.verification.unverified.length === 0 ? (
            <p className="mt-2 flex items-center gap-1.5 text-[12px] text-good-text">
              <CheckCircle2 className="size-3.5" aria-hidden />
              {m.verification.checked > 0 ? `All ${m.verification.checked} figures match FinanceOS calculations.` : "No figures to verify in this answer."}
            </p>
          ) : (
            <p className="mt-2 flex items-start gap-1.5 text-[12px] text-warning-text">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              Could not match these figures to FinanceOS calculations: {m.verification.unverified.join(", ")}. Use the verified data below.
            </p>
          )
        ) : null}
        <DataUsed results={m.results} />
        {m.status === "done" && m.followUps.length ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {m.followUps.map((q) => (
              <button key={q} type="button" onClick={() => onAsk(q)} className="rounded-full border border-border bg-surface px-3 py-1 text-[12px] text-text-2 shadow-card hover:border-border-strong hover:text-text">
                {q}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function AiCfoChat({ suggestions, initialQuestion, companyName, asOfLabel }: { suggestions: string[]; initialQuestion?: string; companyName: string; asOfLabel: string }) {
  const [messages, setMessages] = React.useState<Msg[]>([]);
  const [input, setInput] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const abortRef = React.useRef<AbortController | null>(null);
  const endRef = React.useRef<HTMLDivElement>(null);
  const askedInitial = React.useRef(false);
  const loaded = React.useRef(false);

  // Restore this browser session's conversation.
  React.useEffect(() => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time restore from session storage
      if (raw) setMessages((JSON.parse(raw) as Msg[]).map((m) => (m.role === "assistant" && m.status === "streaming" ? { ...m, status: "error", error: "Interrupted." } : m)));
    } catch {
      // ignore
    }
    loaded.current = true;
  }, []);

  React.useEffect(() => {
    if (!loaded.current) return;
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-40)));
    } catch {
      // ignore quota or privacy errors
    }
  }, [messages]);

  React.useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  const ask = React.useCallback(
    async (questionRaw: string) => {
      const question = questionRaw.trim().slice(0, 1000);
      if (!question || busy) return;
      const prior = messages;
      const lastAssistant = [...prior].reverse().find((m): m is AssistantMsg => m.role === "assistant" && m.status === "done");
      const history = prior
        .filter((m) => m.role === "user" || (m.role === "assistant" && m.status === "done"))
        .slice(-6)
        .map((m) => ({ role: m.role, content: m.content }));
      const userMsg: UserMsg = { id: newId(), role: "user", content: question };
      const aId = newId();
      const assistant: AssistantMsg = { id: aId, role: "assistant", content: "", status: "streaming", mode: null, model: null, calls: [], results: [], verification: null, followUps: [], notice: null, error: null, routing: null, statusText: null };
      setMessages((ms) => [...ms, userMsg, assistant]);
      setInput("");
      setBusy(true);
      const controller = new AbortController();
      abortRef.current = controller;
      const patch = (p: Partial<AssistantMsg> | ((m: AssistantMsg) => Partial<AssistantMsg>)) =>
        setMessages((ms) => ms.map((m) => (m.id === aId && m.role === "assistant" ? { ...m, ...(typeof p === "function" ? p(m) : p) } : m)));
      try {
        const res = await fetch("/api/ai/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question, history, previousCalls: lastAssistant?.calls ?? [] }),
          signal: controller.signal,
        });
        if (!res.ok) {
          patch({ status: "error", error: await errorMessage(res) });
          return;
        }
        await readNdjson<ChatEvent>(res, (e) => {
          if (e.type === "meta") patch({ mode: e.mode, model: e.model, calls: e.calls, results: e.results, notice: e.notice, routing: e.routing });
          else if (e.type === "status") patch({ statusText: e.text });
          else if (e.type === "token") patch((m) => ({ content: m.content + e.text, statusText: null }));
          else if (e.type === "error") patch({ error: `${e.message} Showing the calculated answer instead.` });
          else if (e.type === "done") patch({ content: e.answer, verification: e.verification, followUps: e.followUps, mode: e.mode, status: "done" });
        });
        patch((m) => (m.status === "streaming" ? { status: "done" } : {}));
      } catch (err) {
        if ((err as Error).name === "AbortError") patch((m) => ({ status: "done", content: m.content || "Stopped.", error: null }));
        else patch({ status: "error", error: "Could not reach FinanceOS. Is it still running?" });
      } finally {
        setBusy(false);
        abortRef.current = null;
      }
    },
    [busy, messages],
  );

  React.useEffect(() => {
    if (initialQuestion && !askedInitial.current && loaded.current) {
      askedInitial.current = true;
      void ask(initialQuestion);
    }
  }, [initialQuestion, ask]);

  return (
    <div className="flex min-h-[calc(100dvh-14rem)] flex-col">
      <div className="flex-1 space-y-6 pb-6" aria-live="polite">
        {messages.length === 0 ? (
          <div className="rounded-xl border border-border bg-surface p-6 shadow-card">
            <p className="text-[15px] font-semibold">Ask about {companyName}&apos;s finances</p>
            <p className="mt-1 text-[13px] text-text-3">
              Answers use calculations on your data as of {asOfLabel}. Every figure is computed by FinanceOS, not by the AI model.
            </p>
            <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {suggestions.map((q) => (
                <button key={q} type="button" onClick={() => ask(q)} className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2.5 text-left text-[13px] text-text-2 hover:border-border-strong hover:bg-surface-2/60 hover:text-text">
                  {q}
                  <ChevronRight className="size-4 shrink-0 text-text-3" aria-hidden />
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m) =>
            m.role === "user" ? (
              <div key={m.id} className="flex justify-end">
                <div className="max-w-[85%] rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-[14px] text-primary-fg">{m.content}</div>
              </div>
            ) : (
              <AssistantBubble key={m.id} m={m} onAsk={ask} />
            ),
          )
        )}
        <div ref={endRef} />
      </div>
      <div className="sticky bottom-0 -mx-1 bg-gradient-to-t from-bg via-bg to-bg/0 px-1 pb-2 pt-4">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void ask(input);
          }}
          className="flex items-end gap-2 rounded-xl border border-border-strong bg-surface p-2 shadow-card focus-within:outline-2 focus-within:outline-ring"
        >
          <label htmlFor="ask" className="sr-only">Ask the AI CFO</label>
          <textarea
            id="ask"
            rows={1}
            maxLength={1000}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void ask(input);
              }
            }}
            placeholder="Ask a question, e.g. Which customers should we follow up with?"
            className="max-h-40 min-h-9 flex-1 resize-none bg-transparent px-2 py-1.5 text-[14px] text-text placeholder:text-text-3 focus:outline-none"
          />
          {busy ? (
            <Button type="button" size="icon" variant="secondary" aria-label="Stop" onClick={() => abortRef.current?.abort()}>
              <Square />
            </Button>
          ) : (
            <Button type="submit" size="icon" variant="primary" aria-label="Send" disabled={!input.trim()}>
              <ArrowUp />
            </Button>
          )}
        </form>
        <div className="mt-1.5 flex items-center justify-between px-1 text-[11px] text-text-3">
          <span>Runs locally. Financial data is never sent to an external AI service.</span>
          {messages.length ? (
            <button
              type="button"
              className={cn("inline-flex items-center gap-1 hover:text-text-2", busy && "pointer-events-none opacity-50")}
              onClick={() => {
                setMessages([]);
                try {
                  sessionStorage.removeItem(STORAGE_KEY);
                } catch {
                  // ignore
                }
              }}
            >
              <Trash2 className="size-3" /> Clear conversation
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
