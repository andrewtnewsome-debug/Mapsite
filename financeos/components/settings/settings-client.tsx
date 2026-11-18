"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { Check, Database, FlaskConical, Plug, RefreshCw, Unplug } from "lucide-react";
import type { DataSourceKind } from "@/lib/domain/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Notice } from "@/components/ui/states";
import { Segmented } from "@/components/ui/tabs";
import { Spinner } from "@/components/ui/spinner";

export function DataSourcePicker({ source }: { source: DataSourceKind }) {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  async function choose(next: DataSourceKind) {
    if (next === source) return;
    setError(null);
    const res = await fetch("/api/settings/source", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ source: next }) });
    if (!res.ok) return setError("Could not change the data source.");
    start(() => router.refresh());
  }
  const options: { id: DataSourceKind; title: string; body: string; Icon: typeof Database }[] = [
    { id: "demo", title: "Demo Company", body: "A fictional facilities services company with two years of consistent data. Always available.", Icon: FlaskConical },
    { id: "quickbooks-sandbox", title: "QuickBooks Sandbox", body: "Your Intuit sandbox company, synced read-only. Requires connecting below.", Icon: Database },
  ];
  return (
    <div>
      <div role="radiogroup" aria-label="Data source" className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={source === o.id}
            disabled={pending}
            onClick={() => choose(o.id)}
            className={cn("flex items-start gap-3 rounded-xl border p-4 text-left transition-colors", source === o.id ? "border-text ring-1 ring-text" : "border-border hover:border-border-strong")}
          >
            <o.Icon className="mt-0.5 size-5 shrink-0 text-text-2" aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="flex items-center justify-between gap-2 text-sm font-medium">
                {o.title}
                {source === o.id ? <Check className="size-4" aria-hidden /> : null}
              </span>
              <span className="mt-1 block text-[13px] text-text-3">{o.body}</span>
            </span>
          </button>
        ))}
      </div>
      {pending ? <p className="mt-2 text-[12px] text-text-3"><Spinner /> Switching…</p> : null}
      {error ? <p role="alert" className="mt-2 text-[12px] text-critical-text">{error}</p> : null}
    </div>
  );
}

export function QboActions({ configured, connected }: { configured: boolean; connected: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState<"sync" | "disconnect" | null>(null);
  const [message, setMessage] = React.useState<{ tone: "info" | "critical"; text: string } | null>(null);

  async function sync() {
    setBusy("sync");
    setMessage(null);
    try {
      const res = await fetch("/api/qbo/sync", { method: "POST" });
      const body = (await res.json()) as { ok: boolean; error?: { message: string }; warnings?: number };
      setMessage(body.ok ? { tone: "info", text: `Sync complete.${body.warnings ? ` ${body.warnings} data quality note(s) recorded.` : ""}` } : { tone: "critical", text: body.error?.message ?? "Sync failed." });
    } catch {
      setMessage({ tone: "critical", text: "Could not reach FinanceOS." });
    } finally {
      setBusy(null);
      router.refresh();
    }
  }

  async function disconnect() {
    if (!window.confirm("Disconnect QuickBooks Sandbox? Stored tokens and the synced sandbox data will be deleted from this computer, and FinanceOS will switch to the Demo Company.")) return;
    setBusy("disconnect");
    try {
      const res = await fetch("/api/auth/disconnect", { method: "POST" });
      setMessage(res.ok ? { tone: "info", text: "Disconnected. Tokens and synced sandbox data were removed." } : { tone: "critical", text: "Disconnect failed." });
    } finally {
      setBusy(null);
      router.refresh();
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {!connected ? (
          configured ? (
            <Button asChild variant="primary">
              <a href="/api/auth/connect">
                <Plug /> Connect QuickBooks Sandbox
              </a>
            </Button>
          ) : (
            <Button variant="primary" disabled title="Add your Intuit keys to .env.local first">
              <Plug /> Connect QuickBooks Sandbox
            </Button>
          )
        ) : (
          <>
            <Button variant="primary" onClick={sync} disabled={busy != null}>
              {busy === "sync" ? <Spinner label="Syncing" /> : <RefreshCw />} {busy === "sync" ? "Syncing…" : "Sync now"}
            </Button>
            <Button variant="secondary" onClick={disconnect} disabled={busy != null}>
              <Unplug /> Disconnect
            </Button>
          </>
        )}
      </div>
      {message ? <Notice tone={message.tone === "critical" ? "critical" : "info"}>{message.text}</Notice> : null}
    </div>
  );
}

export function ModelPicker({ current, installed, envDefault }: { current: string; installed: string[]; envDefault: string }) {
  const router = useRouter();
  const [value, setValue] = React.useState(current);
  const [state, setState] = React.useState<"idle" | "saving" | "saved" | "error">("idle");
  async function save(model: string | null) {
    setState("saving");
    const res = await fetch("/api/settings/model", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model }) });
    setState(res.ok ? "saved" : "error");
    if (res.ok) router.refresh();
  }
  return (
    <div className="space-y-2">
      <label htmlFor="model" className="text-[13px] font-medium text-text-2">Model used by the AI CFO</label>
      <div className="flex flex-wrap gap-2">
        {installed.length ? (
          <Select id="model" className="w-64" value={installed.includes(value) ? value : "__custom"} onChange={(e) => e.target.value !== "__custom" && setValue(e.target.value)}>
            {installed.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
            <option value="__custom">Other (type below)</option>
          </Select>
        ) : null}
        <Input aria-label="Model name" className="w-56" value={value} onChange={(e) => setValue(e.target.value)} placeholder="qwen3:4b" />
        <Button onClick={() => save(value.trim() || null)} disabled={state === "saving"}>Save</Button>
        <Button variant="ghost" onClick={() => { setValue(envDefault); void save(null); }}>Use default ({envDefault})</Button>
      </div>
      <p className="text-[12px] text-text-3" aria-live="polite">
        {state === "saved" ? "Saved." : state === "error" ? "Enter a valid model name." : "Any chat model installed in Ollama works. Smaller models are faster; larger models write better explanations."}
      </p>
    </div>
  );
}

export function ThemePicker() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- next-themes hydration guard
  React.useEffect(() => setMounted(true), []);
  if (!mounted) return <div className="h-8" />;
  return (
    <Segmented
      label="Theme"
      value={(theme as "system" | "light" | "dark") ?? "system"}
      onChange={setTheme}
      options={[
        { value: "system", label: "System" },
        { value: "light", label: "Light" },
        { value: "dark", label: "Dark" },
      ]}
    />
  );
}
