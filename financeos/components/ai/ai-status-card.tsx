import { Bot, CheckCircle2, CircleAlert } from "lucide-react";
import type { OllamaStatus, ThinkingMode } from "@/lib/ai/ollama";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function AiStatusCard({ status, configError, thinkingMode = null }: { status: OllamaStatus | null; configError: string | null; thinkingMode?: ThinkingMode | null }) {
  const ready = Boolean(status?.running && status.modelInstalled);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bot className="size-4" aria-hidden /> Local AI
        </CardTitle>
        {ready ? (
          <Badge tone="good">
            <CheckCircle2 aria-hidden /> Ready
          </Badge>
        ) : (
          <Badge tone="warning">
            <CircleAlert aria-hidden /> Limited mode
          </Badge>
        )}
      </CardHeader>
      <CardContent className="space-y-3 text-[13px]">
        {configError ? <p className="text-critical-text">{configError}</p> : null}
        {status ? (
          <dl className="space-y-1.5">
            <div className="flex justify-between gap-2">
              <dt className="text-text-3">Ollama</dt>
              <dd className="font-medium">{status.running ? `Running${status.version ? ` (v${status.version})` : ""}` : "Not running"}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-text-3">Model</dt>
              <dd className="font-medium">{status.model}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-text-3">Installed</dt>
              <dd className="font-medium">{status.running ? (status.modelInstalled ? "Yes" : "No") : "Unknown"}</dd>
            </div>
          </dl>
        ) : null}
        {!ready ? (
          <div className="rounded-lg bg-surface-2 p-3 text-[12px] leading-relaxed text-text-2">
            <p className="font-medium text-text">To turn on full AI chat (free, runs on this computer):</p>
            <ol className="mt-1.5 list-decimal space-y-1 pl-4">
              <li>Install Ollama from ollama.com/download and open it.</li>
              <li>
                In a terminal run: <code className="rounded bg-surface px-1">ollama pull {status?.model ?? "qwen3:4b"}</code>
              </li>
              <li>Reload this page.</li>
            </ol>
            <p className="mt-2">Until then, supported questions are answered directly from FinanceOS calculations.</p>
          </div>
        ) : (
          <>
            <p className="text-[12px] text-text-3">Questions are answered by your local model using figures FinanceOS calculates. Nothing is sent to an external AI service.</p>
            {thinkingMode === "always" ? (
              <div className="rounded-lg border border-warning/40 bg-warning-soft p-3 text-[12px] leading-relaxed text-text-2">
                <p className="font-medium text-text">This model always reasons before it answers.</p>
                <p className="mt-1">
                  On a computer without a graphics card, answers can take 1 to 5 minutes. For faster answers, run <code className="rounded bg-surface px-1">ollama pull qwen3:4b-instruct</code> and select it in Settings.
                </p>
              </div>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}
