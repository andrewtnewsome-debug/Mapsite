import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { answerQuestion, type ChatEvent } from "@/lib/ai/answer";
import { verifyAnswer } from "@/lib/ai/guard";
import { chatStream, getOllamaStatus, OllamaError, ThinkFilter, validateOllamaConfig } from "@/lib/ai/ollama";
import { buildMessages } from "@/lib/ai/prompt";
import { extractDays, extractLimit, extractPeriod, extractWeeks, routeFollowUp, routeQuestion } from "@/lib/ai/router";
import { matchCustomer, runTool } from "@/lib/ai/tools";
import { buildDemoDataset } from "@/lib/demo/generate";
import { startMockOllama } from "./helpers/mock-ollama";

const ds = buildDemoDataset("2026-11-18", { generatedAt: "t" });
const ids = (q: string) => routeQuestion(q, ds).calls.map((c) => c.id);

describe("question routing", () => {
  it.each([
    ["How much cash do we have?", "cash_position"],
    ["Who owes us money?", "top_customers_owed"],
    ["Which customers should we follow up with?", "collections_priorities"],
    ["How profitable were we last month?", "profit_and_loss"],
    ["Are we going to run out of cash?", "cash_forecast"],
    ["Why are our expenses increasing?", "expense_changes"],
    ["What should I be paying attention to this week?", "weekly_briefing"],
    ["Which five customers owe us the most money?", "top_customers_owed"],
    ["How much of our AR is over 60 days old?", "ar_over_days"],
    ["What was our net income last month?", "profit_and_loss"],
    ["What percentage of our invoices are overdue?", "receivables_summary"],
    ["What expenses have increased?", "expense_changes"],
    ["How much cash will we have in eight weeks?", "cash_forecast"],
    ["Which customers should we prioritize for collections?", "collections_priorities"],
    ["What are the biggest financial risks facing the company?", "financial_risks"],
    ["Give me a weekly CFO briefing.", "weekly_briefing"],
    ["What do we owe vendors?", "payables_summary"],
  ])("routes %s to %s", (q, tool) => {
    expect(ids(q)).toContain(tool);
  });

  it("extracts parameters", () => {
    expect(extractLimit("Which five customers owe us the most money?")).toBe(5);
    expect(extractLimit("top 3 customers")).toBe(3);
    expect(extractDays("How much of our AR is over 60 days old?")).toBe(60);
    expect(extractDays("anything ninety days late")).toBe(90);
    expect(extractWeeks("How much cash will we have in eight weeks?")).toBe(8);
    expect(extractWeeks("cash in 20 weeks")).toBe(13);
    expect(extractPeriod("net income last month", "2026-11-18")).toBe("last-month");
    expect(extractPeriod("revenue in October", "2026-11-18")).toBe("2026-10");
    expect(extractPeriod("profit in December", "2026-11-18")).toBe("2025-12");
    expect(extractPeriod("profit year to date", "2026-11-18")).toBe("ytd");
  });

  it("passes parameters to tools", () => {
    expect(routeQuestion("Which five customers owe us the most money?", ds).calls.find((c) => c.id === "top_customers_owed")?.params.limit).toBe(5);
    expect(routeQuestion("How much cash will we have in eight weeks?", ds).calls.find((c) => c.id === "cash_forecast")?.params.weeks).toBe(8);
  });

  it("recognizes customer names", () => {
    expect(matchCustomer(ds, "How much does Granite Peak owe us?")?.name).toBe("Granite Peak Properties");
    expect(ids("What does Ironwood Manufacturing owe?")).toContain("customer_balance");
    expect(matchCustomer(ds, "How is the weather?")).toBeNull();
  });

  it("returns no tools for unrelated questions", () => {
    expect(ids("Tell me a joke about penguins")).toEqual([]);
  });

  it("reuses previous tools for short follow-ups", () => {
    const prev = routeQuestion("What was our net income last month?", ds).calls;
    const fu = routeFollowUp("what about October?", prev, ds);
    expect(fu?.[0]).toEqual({ id: "profit_and_loss", params: { period: "2026-10" } });
  });
});

describe("financial tools", () => {
  it("answers 'how much of our AR is over 60 days' deterministically", () => {
    const r = runTool(ds, { id: "ar_over_days", params: { days: 60 } });
    const amount = r.facts.find((f) => f.label.startsWith("Balance more than 60"))!.value as number;
    const expected = ds.invoices.filter((i) => i.balance > 0 && i.dueDate && (Date.parse(ds.asOfDate) - Date.parse(i.dueDate)) / 864e5 > 60).reduce((s, i) => s + i.balance, 0);
    expect(amount).toBeCloseTo(expected, 2);
    expect(r.summary).toContain("more than 60 days past due");
  });

  it("returns 'Not available' rather than inventing numbers", () => {
    const empty = { ...ds, coverage: { ...ds.coverage, invoices: false } };
    const r = runTool(empty, { id: "receivables_summary", params: {} });
    expect(r.available).toBe(false);
    expect(r.summary).toContain("not available");
  });

  it("labels forecast figures as forecasts and assumptions as assumptions", () => {
    const r = runTool(ds, { id: "cash_forecast", params: { weeks: 8 } });
    expect(r.facts.find((f) => f.label.startsWith("Base case projected cash at week 8"))?.basis).toBe("forecast");
    expect(r.facts.find((f) => f.label === "Weekly payroll assumption")?.basis).toBe("assumption");
    expect(r.facts.find((f) => f.label === "Starting book cash")?.basis).toBe("fact");
  });

  it("puts verified data and strict rules in the prompt", () => {
    const results = [runTool(ds, { id: "cash_position", params: {} })];
    const msgs = buildMessages(ds, "How much cash do we have?", results, []);
    expect(msgs[0].content).toContain("Use ONLY the figures given under VERIFIED DATA");
    expect(msgs.at(-1)!.content).toContain(results[0].facts[0].display);
  });
});

describe("number guard", () => {
  const results = [runTool(ds, { id: "receivables_summary", params: {} })];
  const total = results[0].facts.find((f) => f.label === "Total accounts receivable")!;
  const share = results[0].facts.find((f) => f.label === "Overdue share of receivables (by amount)")!;

  it("accepts figures that match the verified data, including rounded forms", () => {
    const t = total.value as number;
    const answer = `Customers owe ${total.display} (about $${(t / 1_000_000).toFixed(2)}M). ${share.display} is overdue. Reporting date November 18, 2026.`;
    expect(verifyAnswer(answer, results).unverified).toEqual([]);
  });

  it("flags figures that were not supplied", () => {
    const v = verifyAnswer("Customers owe $2,345,678 and 87.3% is overdue.", results);
    expect(v.unverified).toContain("$2,345,678");
    expect(v.unverified).toContain("87.3%");
  });
});

describe("Ollama client", () => {
  it("only allows a local Ollama server", () => {
    expect(() => validateOllamaConfig({ baseUrl: "https://api.example.com" })).toThrow(OllamaError);
    expect(() => validateOllamaConfig({ baseUrl: "http://192.168.1.20:11434" })).toThrow(/local/);
    expect(validateOllamaConfig({}).baseUrl).toBe("http://127.0.0.1:11434");
    expect(validateOllamaConfig({ baseUrl: "http://localhost:11434/" }).baseUrl).toBe("http://localhost:11434");
    expect(() => validateOllamaConfig({ model: "bad model; rm -rf" })).toThrow(OllamaError);
  });

  it("strips <think> blocks across chunk boundaries", () => {
    const f = new ThinkFilter();
    const out = ["Hello <thi", "nk>secret reasoning</th", "ink> world", " <", "b>"].map((c) => f.push(c)).join("") + f.flush();
    expect(out).toBe("Hello  world <b>");
  });

  it("reports when Ollama is not running", async () => {
    const s = await getOllamaStatus(validateOllamaConfig({ baseUrl: "http://127.0.0.1:9" }));
    expect(s.running).toBe(false);
    expect(s.error).toMatch(/not running/);
  });

  describe("against a mock Ollama server", () => {
    let mock: Awaited<ReturnType<typeof startMockOllama>>;
    beforeAll(async () => {
      mock = await startMockOllama({
        models: ["qwen3:4b", "llama3.2:3b"],
        reply: (body) => {
          const data = body.messages.at(-1)!.content;
          const m = /Total book cash balance: (\$[\d,]+)/.exec(data);
          return m ? `<think>internal</think>You have **${m[1]}** in the bank as of November 18, 2026.` : "I can only discuss the verified data.";
        },
        json: { tools: [{ id: "financial_ratios", params: {} }] },
      });
    });
    afterAll(() => mock.close());

    it("detects installed models", async () => {
      const s = await getOllamaStatus(validateOllamaConfig({ baseUrl: mock.baseUrl }));
      expect(s.running).toBe(true);
      expect(s.version).toBe("0.12.6");
      expect(s.modelInstalled).toBe(true);
      const other = await getOllamaStatus(validateOllamaConfig({ baseUrl: mock.baseUrl, model: "mistral" }));
      expect(other.modelInstalled).toBe(false);
    });

    it("streams a reply and sends think:false", async () => {
      const cfg = validateOllamaConfig({ baseUrl: mock.baseUrl });
      let text = "";
      for await (const c of chatStream(cfg, [{ role: "user", content: "Total book cash balance: $1,234" }])) text += c;
      expect(text).toBe("You have **$1,234** in the bank as of November 18, 2026.");
      const last = mock.requests.at(-1)!.body as { think: boolean; stream: boolean };
      expect(last.think).toBe(false);
      expect(last.stream).toBe(true);
    });

    it("explains a missing model", async () => {
      const cfg = validateOllamaConfig({ baseUrl: mock.baseUrl, model: "not-installed:1b" });
      await expect(async () => {
        for await (const _ of chatStream(cfg, [{ role: "user", content: "hi" }])) void _;
      }).rejects.toThrow(/ollama pull not-installed:1b/);
    });

    async function collect(question: string, baseUrl: string | null) {
      const events: ChatEvent[] = [];
      for await (const e of answerQuestion({ question, history: [], previousCalls: [], dataset: ds, ollama: baseUrl ? validateOllamaConfig({ baseUrl }) : null })) events.push(e);
      return events;
    }

    it("answers with the local model from verified data and verifies the figures", async () => {
      const events = await collect("How much cash do we have?", mock.baseUrl);
      const meta = events.find((e) => e.type === "meta")!;
      const done = events.find((e) => e.type === "done")!;
      expect(meta.type === "meta" && meta.mode).toBe("ai");
      expect(done.type === "done" && done.answer).toMatch(/^You have \*\*\$[\d,]+\*\* in the bank/);
      expect(done.type === "done" && done.verification?.unverified).toEqual([]);
      expect(events.some((e) => e.type === "token")).toBe(true);
    });

    it("uses the model to pick tools when rules do not match", async () => {
      const events = await collect("Is our balance sheet in good shape?", mock.baseUrl);
      const meta = events.find((e) => e.type === "meta");
      expect(meta?.type === "meta" && meta.routing).toBe("model");
      expect(meta?.type === "meta" && meta.calls.map((c) => c.id)).toEqual(["financial_ratios"]);
    });

    it("falls back to deterministic answers when Ollama is unavailable", async () => {
      const events = await collect("Which five customers owe us the most money?", "http://127.0.0.1:9");
      const meta = events.find((e) => e.type === "meta")!;
      const done = events.find((e) => e.type === "done")!;
      expect(meta.type === "meta" && meta.mode).toBe("deterministic");
      expect(meta.type === "meta" && meta.notice).toMatch(/Full AI chat requires Ollama/);
      expect(done.type === "done" && done.answer).toContain("Granite Peak Properties");
      expect(events.some((e) => e.type === "token")).toBe(false);
    });

    it("explains supported questions when nothing matches and Ollama is off", async () => {
      const events = await collect("Tell me a joke", "http://127.0.0.1:9");
      const done = events.find((e) => e.type === "done")!;
      expect(done.type === "done" && done.answer).toContain("I can answer questions about");
    });
  });
});
