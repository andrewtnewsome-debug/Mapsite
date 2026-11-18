import http from "node:http";
import type { AddressInfo } from "node:net";

/**
 * A local HTTP server that mimics the Ollama REST API used by FinanceOS:
 * GET /api/version, GET /api/tags, POST /api/chat (streaming NDJSON and JSON).
 */
export interface MockOllamaOptions {
  models?: string[];
  /** Text the model "writes" for streaming chat requests. */
  reply?: (body: { messages: { role: string; content: string }[] }) => string;
  /** JSON returned for structured (format) requests. */
  json?: unknown;
  chunkSize?: number;
  /** Supported `think` values per model, as reported by /api/show (absent = no thinking capability). */
  thinking?: Record<string, (boolean | string)[]>;
}

export async function startMockOllama(opts: MockOllamaOptions = {}) {
  const requests: { path: string; body: unknown }[] = [];
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const body = raw ? JSON.parse(raw) : null;
      requests.push({ path: req.url ?? "", body });
      if (req.url === "/api/version") return res.end(JSON.stringify({ version: "0.12.6" }));
      if (req.url === "/api/tags") {
        return res.end(JSON.stringify({ models: (opts.models ?? ["qwen3:4b"]).map((name) => ({ name, model: name, size: 2_500_000_000, modified_at: "2026-01-01T00:00:00Z", details: { parameter_size: "4.0B" } })) }));
      }
      if (req.url === "/api/show") {
        const values = opts.thinking?.[body.model];
        return res.end(JSON.stringify({ capabilities: ["completion", ...(values ? ["thinking"] : [])], ...(values ? { thinking: { values, default: values[0] } } : {}), details: { family: "test" } }));
      }
      if (req.url === "/api/chat") {
        if (!(opts.models ?? ["qwen3:4b"]).includes(body.model)) {
          res.statusCode = 404;
          return res.end(JSON.stringify({ error: `model "${body.model}" not found, try pulling it first` }));
        }
        if (body.format) {
          return res.end(JSON.stringify({ model: body.model, message: { role: "assistant", content: JSON.stringify(opts.json ?? { tools: [] }) }, done: true }));
        }
        const text = opts.reply ? opts.reply(body) : "OK.";
        res.setHeader("Content-Type", "application/x-ndjson");
        // Like real Ollama: with think enabled, reasoning arrives in a separate "thinking" field.
        if (body.think && body.think !== false) {
          res.write(JSON.stringify({ model: body.model, message: { role: "assistant", content: "", thinking: "Let me work through the verified data..." }, done: false }) + "\n");
        }
        const size = opts.chunkSize ?? 7;
        for (let i = 0; i < text.length; i += size) {
          res.write(JSON.stringify({ model: body.model, created_at: "2026-01-01T00:00:00Z", message: { role: "assistant", content: text.slice(i, i + size) }, done: false }) + "\n");
        }
        res.end(JSON.stringify({ model: body.model, message: { role: "assistant", content: "" }, done: true, done_reason: "stop" }) + "\n");
        return;
      }
      res.statusCode = 404;
      res.end("{}");
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  return { baseUrl: `http://127.0.0.1:${port}`, requests, close: () => new Promise<void>((r) => server.close(() => r())) };
}
