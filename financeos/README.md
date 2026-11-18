# FinanceOS

**An AI finance employee for small and lower-middle-market businesses ($1M–$30M revenue).**
FinanceOS answers the questions a business owner actually asks — *How much cash do we have? Who owes us money? Are we going to run out of cash?* — from the company's real accounting data, with every number calculated by code and explained by a local AI model.

> **Status: local prototype.** Runs entirely on your computer. Connects read-only to a QuickBooks Online **sandbox** company. No real financial data, no production bank connections, no payments, no automated accounting changes, no cloud services, no per-message AI fees. It does not provide production-grade data protection or regulatory compliance.

New here? Follow **[SETUP_GUIDE.md](SETUP_GUIDE.md)** (step-by-step for Windows).

---

## What it does

| Area | What you get |
| --- | --- |
| **Overview** | Cash, receivables, overdue AR, payables, last month's revenue/expenses/net income with month-over-month change, revenue vs. expense chart, historical cash, largest overdue customers, financial health indicators, rule-based alerts, data source and sync status. |
| **AI CFO** | Plain-English Q&A. Figures come from deterministic calculations; a local model (Ollama, default `qwen3:4b`) writes the explanation; every figure in the answer is checked against the calculations. Works in a limited, calculation-only mode without Ollama. |
| **Accounts Receivable** | Aging (Current, 1–30, 31–60, 61–90, 90+), customer balances, unpaid invoice list with filters (customer, aging bucket, status, balance, due date), partial payments, collections priority score, CSV export, reconciliation to the QuickBooks A/R Aging report. |
| **Cash Flow** | Historical cash by month, operating/investing/financing flows, working capital metrics, and an interactive **13-week forecast** with base/conservative/optimistic scenarios, editable assumptions, one-time items, and minimum-cash warnings. |
| **Profitability** | Monthly and trailing P&L, margins, net income trend, expense changes with significance flags, revenue concentration. |
| **Financial Reports** | Profit & Loss, Balance Sheet, Cash Flow Statement, AR Aging, ratios — monthly, quarterly or annual, compared with the prior period or prior year, exportable to CSV. One-click printable **management summary**. |
| **Collections** | Ranked customers, suggested next actions, reminder email drafts that cite exact invoice numbers and amounts, copy to clipboard, optional AI polishing, a local follow-up list that requires your approval. Never sends email. |
| **Invoice Assistant** | Describe an invoice in plain English; get an editable draft with computed totals. Never creates invoices in QuickBooks. |
| **Insights** | Rule-triggered observations that separate **verified facts**, **mathematical forecasts**, **assumptions** and **AI interpretation**. |
| **Settings** | Switch between Demo Company and QuickBooks Sandbox, connect/sync/disconnect QuickBooks, choose the local model, theme, activity log. |

A fictional demo company (**Alder Creek Facility Services**, ~$7.5M revenue, commercial facilities services) is built in, so everything works before QuickBooks is connected. Demo data is labeled everywhere and never mixed with sandbox data.

---

## Architecture

```
financeos/
├── app/                      Next.js App Router
│   ├── (app)/                Pages (Overview, AI CFO, Receivables, Cash Flow, ...)
│   └── api/                  Route handlers (OAuth, sync, AI chat, exports, local stores)
├── components/               UI (design system in components/ui, charts, finance, ai, layout)
├── lib/
│   ├── domain/               Canonical financial data model, date and money helpers
│   ├── demo/                 Deterministic fictional company (transaction-level)
│   ├── finance/              Deterministic calculations: aging, statements, ratios,
│   │                         forecast, insights, collections, invoice drafts, reports
│   ├── ai/                   AI CFO: question router, financial tools, prompt,
│   │                         Ollama client, number guard, narratives
│   ├── qbo/                  QuickBooks: OAuth, encrypted token store, sandbox API
│   │                         client, report/entity parsers, sync, snapshot
│   └── server/               Workspace loader, local JSON store, settings, audit log,
│                             request context and permissions
├── proxy.ts                  Rejects requests not addressed to localhost (DNS rebinding)
├── tests/                    Vitest suites (finance engine, AI, QuickBooks, Phase 2)
└── scripts/                  Cross-platform launchers and maintenance scripts
```

### One canonical data model
Every source is mapped into a single `FinancialDataset` (`lib/domain/types.ts`): accounts, customers, vendors, invoices, bills, payments, monthly P&L lines, balance sheet snapshots, monthly cash flow lines, plus coverage flags and data-quality warnings. All analytics run on this shape, so the demo company, QuickBooks Sandbox and future integrations (Xero, bank feeds) behave identically. A value a source could not provide is `null` and shown as **"Not available"** — never invented.

### How the AI CFO answers (no invented numbers)
1. **Interpret** — a deterministic router (`lib/ai/router.ts`) maps the question to financial tools and parameters (e.g. *"top five customers"* → `top_customers_owed{limit:5}`). If no rule matches and Ollama is running, the model may choose from a whitelisted tool list; its choice is validated.
2. **Calculate** — tools (`lib/ai/tools.ts`) compute results in TypeScript with the reporting date, source, assumptions and a basis label on every figure (*recorded*, *forecast*, *assumption*).
3. **Explain** — only those verified results are sent to the local model with strict instructions (`lib/ai/prompt.ts`).
4. **Verify** — `lib/ai/guard.ts` checks every dollar amount, percentage and large number in the reply against the verified figures and flags anything that does not match.
5. **Fallback** — without Ollama, the same tools produce a deterministic plain-English answer and the UI explains that full AI chat requires Ollama.

The Ollama client refuses any non-local address, so financial data cannot be sent to an external AI service even by misconfiguration.

### QuickBooks Online (sandbox, read-only)
- OAuth 2.0 via Intuit's authorization and token endpoints; all accounting API calls go **only** to `https://sandbox-quickbooks.api.intuit.com/v3` (enforced in code).
- OAuth `state`: random, HMAC-signed, 10-minute expiry, single use; host canonicalization so the state cookie and the callback share an origin.
- Tokens encrypted at rest (AES-256-GCM) in `.data/`, refreshed automatically before expiry and after a 401, with Intuit's rotated refresh tokens persisted; explicit errors for expired, revoked or invalid credentials.
- Pagination (`STARTPOSITION`/`MAXRESULTS`), rate-limit backoff, Intuit `Fault` parsing, partial-failure tolerance.
- Nested report parsing for ProfitAndLoss, BalanceSheet, CashFlow (summarized by month) and AgedReceivables; our AR total is reconciled against QuickBooks' report.
- Only `GET` requests are made. There is no code path that writes to QuickBooks.

### Local storage
A small JSON file store in `financeos/.data/` (git-ignored) — chosen over SQLite so installation on Windows needs no native compiler. Holds settings, encrypted QuickBooks tokens and snapshot, saved forecast assumptions, follow-ups, invoice drafts and an append-only activity log. Storage is behind small repository modules, so it can be swapped for Postgres later.

### Ready for commercialization (not activated)
Request context with tenant/user/role and a permission check on every API route (`lib/server/context.ts`), an audit log, per-company scoping of stored data, provider-agnostic data model. See [PRODUCT_ROADMAP.md](PRODUCT_ROADMAP.md).

---

## Tech stack
Next.js 16 (App Router, Turbopack) · React 19 · TypeScript 5.9 · Tailwind CSS 4 · Radix UI primitives · Recharts 3 · Zod 4 · Vitest 5 · Ollama (local inference) · Intuit QuickBooks Online Accounting API (sandbox). No database server, Docker or cloud services required.

## Commands
Run inside the `financeos` folder:

| Command | What it does |
| --- | --- |
| `npm install` | Install dependencies (first time only) |
| `npm run dev` | Start FinanceOS at http://localhost:3000 (development mode) |
| `npm run build` then `npm start` | Production build and server (faster pages) |
| `npm test` | Run automated tests |
| `npm run typecheck` / `npm run lint` | TypeScript and ESLint checks |
| `npm run check` | Typecheck + lint + tests + production build |
| `npm run clean` | Delete the Next.js build cache (`.next`) |
| `npm run reset-local-data` | Delete local data (tokens, snapshot, drafts, settings) |

On Windows you can also double-click **`start-financeos.cmd`**.

## Testing
130 automated tests cover AR aging and date boundaries, partial payments, customer aggregation, collections scoring, statements and ratios, periods, the 13-week forecast and scenarios, missing-data handling, demo-data accounting identities, AI routing and tools, the number guard, the Ollama client against a protocol-faithful mock server, QuickBooks OAuth/state/token handling, the API client (pagination, refresh, backoff), report and entity parsing with mocked Intuit responses, invoice parsing, CSV safety and the localhost host guard.

**Not yet verified against live services:** QuickBooks has been tested with mocked Intuit responses only, and the AI CFO has not yet been run against a real `qwen3:4b` model (see "Known limitations" in [CLAUDE.md](CLAUDE.md)).
