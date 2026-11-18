"use client";

import * as React from "react";
import { AlertTriangle, Bot, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Notice } from "@/components/ui/states";
import { Spinner } from "@/components/ui/spinner";
import { Markdown } from "./markdown";
import { errorMessage, readNdjson } from "./stream";

type Event = { type: "token"; text: string } | { type: "done"; text: string; unverified: string[]; model: string } | { type: "error"; message: string; code: string };

export function useNarrative(body: Record<string, unknown>) {
  const [text, setText] = React.useState("");
  const [state, setState] = React.useState<"idle" | "loading" | "done" | "error">("idle");
  const [error, setError] = React.useState<string | null>(null);
  const [unverified, setUnverified] = React.useState<string[]>([]);
  const [model, setModel] = React.useState<string | null>(null);
  const bodyJson = JSON.stringify(body);

  const run = React.useCallback(async () => {
    setText("");
    setError(null);
    setUnverified([]);
    setState("loading");
    try {
      const res = await fetch("/api/ai/narrative", { method: "POST", headers: { "Content-Type": "application/json" }, body: bodyJson });
      if (!res.ok) {
        setError(await errorMessage(res));
        setState("error");
        return;
      }
      let failed = false;
      await readNdjson<Event>(res, (e) => {
        if (e.type === "token") setText((t) => t + e.text);
        else if (e.type === "done") {
          setText(e.text);
          setUnverified(e.unverified);
          setModel(e.model);
        } else if (e.type === "error") {
          failed = true;
          setError(e.message);
        }
      });
      setState(failed ? "error" : "done");
    } catch {
      setError("Could not reach FinanceOS.");
      setState("error");
    }
  }, [bodyJson]);

  return { text, state, error, unverified, model, run };
}

export function AiInterpretation({ text, unverified, model, streaming }: { text: string; unverified: string[]; model: string | null; streaming?: boolean }) {
  return (
    <div className="rounded-lg border border-border bg-surface-2/50 p-3.5 text-[13px]">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Badge tone="accent">
          <Bot aria-hidden /> AI interpretation
        </Badge>
        <span className="text-[12px] text-text-3">Written by your local model{model ? ` (${model})` : ""} from the verified figures. Not a source of new facts.</span>
      </div>
      <Markdown text={text} />
      {streaming ? <span className="mt-1 inline-block h-3 w-1.5 animate-pulse bg-text-3 align-middle" aria-hidden /> : null}
      {!streaming && unverified.length ? (
        <p className="mt-2 flex items-start gap-1.5 text-[12px] text-warning-text">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden /> Could not match these figures to FinanceOS calculations: {unverified.join(", ")}. Rely on the verified numbers above.
        </p>
      ) : null}
    </div>
  );
}

export function NarrativePanel({ kind, title }: { kind: "management-summary"; title: string }) {
  const { text, state, error, unverified, model, run } = useNarrative({ kind });
  return (
    <Card className="no-print-if-empty">
      <CardHeader>
        <div>
          <CardTitle>{title}</CardTitle>
          <CardDescription>Optional. Your local AI model explains the figures above in plain English. Requires Ollama.</CardDescription>
        </div>
        <Button size="sm" onClick={run} disabled={state === "loading"} className="no-print">
          {state === "loading" ? <Spinner label="Writing commentary" /> : state === "done" ? <RefreshCw /> : <Bot />}
          {state === "done" ? "Regenerate" : "Write commentary"}
        </Button>
      </CardHeader>
      <CardContent>
        {state === "idle" ? <p className="text-[13px] text-text-3">No commentary yet.</p> : null}
        {error ? <Notice tone="warning">{error}</Notice> : null}
        {text ? <AiInterpretation text={text} unverified={unverified} model={model} streaming={state === "loading"} /> : null}
      </CardContent>
    </Card>
  );
}
