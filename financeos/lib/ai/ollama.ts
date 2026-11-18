/**
 * Minimal Ollama client for local inference.
 *
 * Security: financial data may only be sent to a model running on this
 * computer. The client refuses any base URL whose host is not a loopback
 * address, so a misconfigured OLLAMA_BASE_URL cannot send data to an external
 * AI service.
 */

export const DEFAULT_OLLAMA_URL = "http://127.0.0.1:11434";
export const DEFAULT_OLLAMA_MODEL = "qwen3:4b";

export class OllamaError extends Error {
  constructor(
    message: string,
    public readonly code: "unavailable" | "model-missing" | "timeout" | "bad-config" | "bad-response",
  ) {
    super(message);
    this.name = "OllamaError";
  }
}

export interface OllamaConfig {
  baseUrl: string;
  model: string;
  timeoutMs: number;
}

const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
const MODEL_NAME = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,99}$/;

export function validateOllamaConfig(input: { baseUrl?: string | null; model?: string | null; timeoutSeconds?: string | number | null }): OllamaConfig {
  const baseUrl = (input.baseUrl?.trim() || DEFAULT_OLLAMA_URL).replace(/\/+$/, "");
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new OllamaError("OLLAMA_BASE_URL is not a valid URL.", "bad-config");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new OllamaError("OLLAMA_BASE_URL must use http.", "bad-config");
  if (!LOOPBACK.has(url.hostname)) {
    throw new OllamaError("FinanceOS only sends financial data to a local Ollama server (127.0.0.1 or localhost). Update OLLAMA_BASE_URL.", "bad-config");
  }
  const model = input.model?.trim() || DEFAULT_OLLAMA_MODEL;
  if (!MODEL_NAME.test(model)) throw new OllamaError("The configured model name is not valid.", "bad-config");
  const seconds = Number(input.timeoutSeconds ?? 180);
  return { baseUrl, model, timeoutMs: Math.min(900, Math.max(10, Number.isFinite(seconds) ? seconds : 180)) * 1000 };
}

export interface OllamaModelInfo {
  name: string;
  sizeBytes: number | null;
  parameterSize: string | null;
  modifiedAt: string | null;
}

export interface OllamaStatus {
  running: boolean;
  version: string | null;
  models: OllamaModelInfo[];
  model: string;
  modelInstalled: boolean;
  baseUrl: string;
  error: string | null;
}

function isConnectionError(err: unknown): boolean {
  const e = err as { cause?: { code?: string }; code?: string; name?: string };
  const code = e?.cause?.code ?? e?.code;
  return code === "ECONNREFUSED" || code === "ENOTFOUND" || code === "EHOSTUNREACH" || code === "ECONNRESET" || code === "UND_ERR_CONNECT_TIMEOUT" || e?.name === "TypeError";
}

function modelMatches(installed: string, wanted: string): boolean {
  if (installed === wanted) return true;
  // "qwen3" means "qwen3:latest"
  return !wanted.includes(":") && installed === `${wanted}:latest`;
}

export async function getOllamaStatus(cfg: OllamaConfig, fetchImpl: typeof fetch = fetch): Promise<OllamaStatus> {
  const status: OllamaStatus = { running: false, version: null, models: [], model: cfg.model, modelInstalled: false, baseUrl: cfg.baseUrl, error: null };
  try {
    const v = await fetchImpl(`${cfg.baseUrl}/api/version`, { signal: AbortSignal.timeout(2500), cache: "no-store" });
    if (!v.ok) throw new Error(`HTTP ${v.status}`);
    status.version = ((await v.json()) as { version?: string }).version ?? null;
    status.running = true;
    const t = await fetchImpl(`${cfg.baseUrl}/api/tags`, { signal: AbortSignal.timeout(4000), cache: "no-store" });
    if (t.ok) {
      const body = (await t.json()) as { models?: { name?: string; model?: string; size?: number; modified_at?: string; details?: { parameter_size?: string } }[] };
      status.models = (body.models ?? [])
        .map((m) => ({ name: m.name ?? m.model ?? "", sizeBytes: typeof m.size === "number" ? m.size : null, parameterSize: m.details?.parameter_size ?? null, modifiedAt: m.modified_at ?? null }))
        .filter((m) => m.name);
      status.modelInstalled = status.models.some((m) => modelMatches(m.name, cfg.model));
    }
  } catch (err) {
    status.running = false;
    status.error = isConnectionError(err) || (err as Error).name === "TimeoutError" ? "Ollama is not running or not reachable." : (err as Error).message;
  }
  return status;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface ChatOptions {
  temperature?: number;
  numCtx?: number;
  signal?: AbortSignal;
  format?: unknown;
}

function buildBody(cfg: OllamaConfig, messages: ChatMessage[], stream: boolean, opts: ChatOptions) {
  return JSON.stringify({
    model: cfg.model,
    messages,
    stream,
    // Qwen3 and other reasoning models: answer directly without a long hidden reasoning phase.
    think: false,
    keep_alive: "15m",
    ...(opts.format ? { format: opts.format } : {}),
    options: { temperature: opts.temperature ?? 0.2, num_ctx: opts.numCtx ?? 8192 },
  });
}

async function post(cfg: OllamaConfig, body: string, opts: ChatOptions, fetchImpl: typeof fetch): Promise<Response> {
  const timeout = AbortSignal.timeout(cfg.timeoutMs);
  const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;
  let res: Response;
  try {
    res = await fetchImpl(`${cfg.baseUrl}/api/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body, signal, cache: "no-store" });
  } catch (err) {
    if ((err as Error).name === "TimeoutError") throw new OllamaError("The local model took too long to respond.", "timeout");
    if ((err as Error).name === "AbortError") throw err;
    throw new OllamaError("Ollama is not running or not reachable.", "unavailable");
  }
  if (!res.ok) {
    let detail = "";
    try {
      detail = ((await res.json()) as { error?: string }).error ?? "";
    } catch {
      // ignore
    }
    if (res.status === 404 || /not found/i.test(detail)) {
      throw new OllamaError(`The model "${cfg.model}" is not installed. Run: ollama pull ${cfg.model}`, "model-missing");
    }
    throw new OllamaError(`Ollama returned an error (${res.status})${detail ? `: ${detail}` : ""}.`, "bad-response");
  }
  return res;
}

/** Removes <think>...</think> blocks, including across streamed chunks. */
export class ThinkFilter {
  private inThink = false;
  private buffer = "";

  push(chunk: string): string {
    this.buffer += chunk;
    let out = "";
    for (;;) {
      if (this.inThink) {
        const end = this.buffer.indexOf("</think>");
        if (end === -1) {
          this.buffer = this.buffer.slice(-8);
          return out;
        }
        this.buffer = this.buffer.slice(end + 8);
        this.inThink = false;
      } else {
        const start = this.buffer.indexOf("<think>");
        if (start === -1) {
          // Hold back a possible partial "<think>" tag at the end of the buffer.
          let hold = 0;
          for (let k = Math.min(6, this.buffer.length); k > 0; k--) {
            if ("<think>".startsWith(this.buffer.slice(-k))) {
              hold = k;
              break;
            }
          }
          out += this.buffer.slice(0, this.buffer.length - hold);
          this.buffer = this.buffer.slice(this.buffer.length - hold);
          return out;
        }
        out += this.buffer.slice(0, start);
        this.buffer = this.buffer.slice(start + 7);
        this.inThink = true;
      }
    }
  }

  flush(): string {
    const rest = this.inThink ? "" : this.buffer;
    this.buffer = "";
    return rest;
  }
}

/** Streams assistant text from Ollama's NDJSON /api/chat response. */
export async function* chatStream(cfg: OllamaConfig, messages: ChatMessage[], opts: ChatOptions = {}, fetchImpl: typeof fetch = fetch): AsyncGenerator<string> {
  const res = await post(cfg, buildBody(cfg, messages, true, opts), opts, fetchImpl);
  if (!res.body) throw new OllamaError("Ollama returned an empty response.", "bad-response");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const filter = new ThinkFilter();
  let pending = "";
  try {
    for (;;) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch (err) {
        if ((err as Error).name === "TimeoutError") throw new OllamaError("The local model took too long to respond.", "timeout");
        throw err;
      }
      if (chunk.done) break;
      pending += decoder.decode(chunk.value, { stream: true });
      let nl: number;
      while ((nl = pending.indexOf("\n")) >= 0) {
        const line = pending.slice(0, nl).trim();
        pending = pending.slice(nl + 1);
        if (!line) continue;
        let obj: { message?: { content?: string }; done?: boolean; error?: string };
        try {
          obj = JSON.parse(line);
        } catch {
          continue;
        }
        if (obj.error) throw new OllamaError(`Ollama error: ${obj.error}`, "bad-response");
        const text = obj.message?.content ?? "";
        if (text) {
          const visible = filter.push(text);
          if (visible) yield visible;
        }
        if (obj.done) {
          const rest = filter.flush();
          if (rest) yield rest;
          return;
        }
      }
    }
    const rest = filter.flush();
    if (rest) yield rest;
  } finally {
    reader.releaseLock();
  }
}

/** Non-streaming chat returning parsed JSON (Ollama structured outputs). */
export async function chatJson<T>(cfg: OllamaConfig, messages: ChatMessage[], schema: unknown, opts: ChatOptions = {}, fetchImpl: typeof fetch = fetch): Promise<T> {
  const res = await post(cfg, buildBody(cfg, messages, false, { ...opts, format: schema, temperature: 0 }), opts, fetchImpl);
  const body = (await res.json()) as { message?: { content?: string } };
  const content = (body.message?.content ?? "").replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  try {
    return JSON.parse(content) as T;
  } catch {
    throw new OllamaError("The local model returned output that was not valid JSON.", "bad-response");
  }
}
