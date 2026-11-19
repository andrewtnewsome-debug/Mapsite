# CLAUDE.md — FinanceOS project context

This file preserves context for future Claude Code sessions. Read it fully before changing code. The repository root (`Mapsite/`) also contains unrelated projects (`index.html`, `portal/`); **FinanceOS lives entirely in `financeos/`** — run all commands from there.

@AGENTS.md

## Product in one paragraph
FinanceOS is an AI finance employee for small and lower-middle-market businesses ($1M–$30M revenue). The founder (non-engineer, PE/M&A background) wants owners to ask plain-English questions and get accurate answers from their real accounting data. Current version: a **local-only prototype** — Next.js app on `http://localhost:3000`, QuickBooks Online **sandbox** (read-only), local AI via **Ollama** (`qwen3:4b` default), built-in fictional **demo company**. Zero paid services, no Docker, must work on **Windows**.

## Non-negotiable rules (from the founder)
1. The LLM never invents or computes numbers. All figures come from deterministic TypeScript; the model only explains. Keep the number guard.
2. Never send financial data to an external AI service. Ollama client must stay loopback-only.
3. QuickBooks: sandbox only, read-only (GET only), development credentials only. Never add write calls.
4. Missing data shows "Not available" — never a fabricated number or silent zero.
5. Demo and QuickBooks data must never mix. Label demo data everywhere.
6. Separate historical facts, forecasts, assumptions and AI interpretation in the UI.
7. No paid infrastructure, no cloud hosting, no public deployment. Secrets only in `.env.local` (git-ignored); never log tokens or secrets.
8. No fake buttons or simulated AI presented as real. If something needs Ollama or QuickBooks, say so.
9. Don't claim live QuickBooks or real-model AI works until actually tested (see Known limitations).

## Architecture map
- `lib/domain/types.ts` — **canonical `FinancialDataset`**. Every source maps into this; every calculation reads it. Dates are ISO `YYYY-MM-DD` strings (UTC math in `lib/domain/dates.ts`); money rounded to cents (`lib/domain/money.ts`).
- `lib/demo/` — deterministic fictional company built from transactions (invoices, payments, bills, payroll, capex, loan, distributions). Statements are derived so they tie out (tests assert A = L + E, AR = open invoices, cash flow reconciles). Generated relative to *today*; history is stable within a month (seeded by month keys). Contract revenue in the partial current month is recognized ratably with deferred revenue.
- `lib/finance/` — pure deterministic engine: `aging.ts` (AR/AP aging, customer balances, collections priority, historical reconstruction), `statements.ts`, `periods.ts` (fiscal quarters/years, keys like `M:2026-10`, `Q:2026-3:1`, `Y:2026:1`), `ratios.ts`, `metrics.ts` (cash position, headline metrics, expense changes, health indicators), `forecast.ts` (13-week receipts/disbursements, scenarios, data-derived defaults with explanations), `insights.ts`, `summary.ts`, `report-tables.ts`, `collections.ts`, `invoice-draft.ts`, `revenue.ts`, `ar-filters.ts`, `forecast-schema.ts`.
- `lib/ai/` — `router.ts` (deterministic intent + parameter extraction), `tools.ts` (14 tools returning facts with basis fact/forecast/assumption), `prompt.ts`, `ollama.ts` (loopback-only, `think:false`, streaming NDJSON, `<think>` filter), `guard.ts` (number verification), `answer.ts` (pipeline + model tool selection + fallback), `narrative.ts`, `followups.ts`.
- `lib/qbo/` — `config.ts` (endpoints, sandbox host guard, env validation), `state.ts` (HMAC-signed expiring single-use OAuth state), `oauth.ts`, `crypto.ts` (AES-256-GCM; key from `FINANCEOS_ENCRYPTION_KEY` or `.data/secret.key`), `connection-store.ts`, `client.ts` (GET-only, pagination, 401 refresh, backoff), `parse-reports.ts`, `parse-entities.ts`, `assemble.ts` (pure dataset assembly, partial failures → coverage gaps), `sync.ts`, `snapshot.ts` (encrypted).
- `lib/server/` — `workspace.ts` (`loadWorkspace()` — single entry for pages; calls `connection()` so pages render per request; never substitutes demo data for QBO), `store.ts` (JSON files in `.data/`, atomic writes with Windows retry), `settings.ts`, `audit.ts`, `context.ts` (tenant/user/role + `requirePermission`), `http.ts` (body size cap, same-origin check), `forecast-store.ts`, `followups.ts`, `invoice-drafts.ts`, `ai-config.ts`, `notifications.ts`, `ndjson.ts`.
- `app/(app)/*` — pages. `app/api/*` — route handlers. `proxy.ts` — rejects non-loopback Host headers (DNS rebinding).
- `components/ui` (design system), `components/charts` (Recharts kit), `components/finance`, `components/ai`, `components/layout`, `components/settings`.

## Coding standards
- TypeScript strict. Validate all external input with Zod (API bodies, saved files, model output).
- Calculations: pure functions in `lib/finance`, tested in `tests/`. UI never computes financial figures itself (except invoice line totals via `computeInvoiceTotals`).
- Return `null` + reason for unavailable values; format with `lib/format.ts` (`NOT_AVAILABLE`).
- Every state-changing API route: `isSameOrigin` check + `requirePermission` + `audit()` for security-relevant actions.
- Server-only modules start with `import "server-only"` (aliased to a stub in Vitest).
- Next.js 16: `cookies()`, `headers()`, `params`, `searchParams` are async; middleware is `proxy.ts`; `next lint` is gone (use `eslint .`). Read `node_modules/next/dist/docs/` before using unfamiliar APIs.
- Charts: use `components/charts/chart-kit.tsx` tokens. Palette validated with the dataviz validator: categorical `--series-1..3` (blue, orange, aqua) pass all-pairs CVD checks in both themes; aging uses an ordinal blue ramp `--age-1..5`; status colors are reserved for state. One y-axis per chart; legends for 2+ series; table view via `ChartTable`.
- Design tokens live in `app/globals.css` (`:root` and `.dark`); Tailwind v4 `@theme inline` maps them to classes (`bg-surface`, `text-text-2`, ...).
- Windows compatibility: no native npm dependencies, no shell-specific npm scripts (use `node scripts/*.mjs`), `path.join` everywhere, CRLF for `.cmd` files.
- Keep `npm run check` green (typecheck, lint, tests, build with no warnings).

## Key decisions (and why)
- **JSON file store instead of SQLite**: avoids native builds (`better-sqlite3` needs C++ tools on Windows). Swap for Postgres when multi-tenant.
- **TypeScript 5.9, not 7**: Next.js type-checking relies on the JS compiler API.
- **Deterministic router first, model tool selection second**: supported questions work without Ollama and can't be misrouted by the model.
- **Forecast defaults derived from data** with a per-assumption explanation and basis badge; scenarios are fixed deltas (documented in `SCENARIOS`).
- **QuickBooks snapshot**: sync once, read locally (fast pages, consistent numbers, no API calls per page view).
- **Dev binding to 127.0.0.1** plus `proxy.ts` host check; the connect route redirects to the redirect-URI origin so the state cookie matches the callback host.
- **Next.js telemetry disabled** through `scripts/next.mjs` (cross-platform env injection).
- **Thinking models**: tested with real `qwen3:4b` (Ollama 0.40.16). It is the Qwen3-4B 2507 *thinking* build: `think:false` is ignored and reasoning leaks into `content` ending with a bare `</think>`. `lib/ai/ollama.ts` reads `/api/show` → `thinking.values` per model: sends `think:false` when allowed, otherwise the lowest level (`true`), and Ollama then returns reasoning in `message.thinking`, which is discarded. `stripReasoning()` cleans any orphan `</think>` from final answers. The chat shows a "reasoning" status and elapsed timer. `qwen3:4b-instruct` answers directly (no thinking) and is much faster on CPU.
- **Budgets** are drafted from prior-year actuals per account (monthly pattern kept, growth applied), one budget per data-source scope for the current fiscal year (`.data/budgets.json`).
- **Data checks** (`lib/finance/reconcile.ts`) reconcile A/R, A/P, cash, cash flow, YTD net income and QuickBooks report totals (captured at sync as `sourceTotals`).

## Commands
`npm run dev` · `npm run build` / `npm start` · `npm test` · `npm run typecheck` · `npm run lint` · `npm run check` · `npm run clean` · `npm run reset-local-data`

## Completed functionality (as of 2026-11-18)
- Phase 1: app shell (sidebar, top bar with source switcher, alerts, theme), Overview, AR (aging, filters, priorities, CSV, QBO reconciliation), Cash Flow (history + interactive 13-week forecast with scenarios, saved assumptions, CSV), Profitability, Financial Reports (P&L/BS/CF/AR aging/ratios, month/quarter/year, prior period/year, CSV, printable management summary + optional AI commentary), AI CFO (streaming chat, verified-data panel, follow-ups, session history, fallback), QuickBooks sandbox integration (OAuth, encrypted tokens, refresh, sync, disconnect, parsers), Settings.
- Phase 2: Collections assistant (drafts, approval-based follow-up list, optional AI polish), Invoice assistant (rules + optional AI parsing, editable drafts), Insights page.
- Round 2 (2026-11-18): real-model testing and thinking-model handling; `npm run eval:ai` (resumable, scored report in `.data/eval/`); AI uses saved forecast assumptions and budgets; vendor-level expense drivers from bills; Budget vs Actual page + `budget_variance` tool; data checks in Settings; upcoming vendor payments; amount-free QuickBooks report-structure download; self-verifying parent-account parsing; stale-data alerts; axe-core audit with zero WCAG 2.1 AA violations in both themes.
- Phase 3 groundwork: tenant/user/role context and permissions, audit log, per-company scoping of stored data, provider-agnostic model; `PRODUCT_ROADMAP.md`.
- 146 automated tests; production build clean; smoke-tested all pages (desktop + mobile, light + dark) in Chromium.

## Known limitations / not yet verified
- **Live QuickBooks not tested.** The build environment could not reach Intuit hosts, and connecting requires the founder's Intuit login. Parsers are tested against mocked responses shaped like Intuit's. First real sync may reveal report-structure differences (e.g. unusual groups, multi-currency, sub-customers). Check Settings → "Data quality notes" and the AR reconciliation banner after the first sync.
- **AI CFO tested with real models on a 4-core CPU without a GPU** (summary in README): `qwen3:4b-instruct` 20/20 routing, 133/134 figures verified, median 32 s; `qwen3:4b` 6/6 routing, 43/44 figures, median 2 min 39 s. Remaining mismatches are model transcription or self-computed percentages, which the guard flags; when one appears, add the figure to the tool's facts rather than relying on the model. Answer quality on other models is untested.
- **Not run on Windows itself** (built and tested on Linux). Cross-platform precautions are in place; first run on Windows should follow SETUP_GUIDE.md.
- AR aging uses invoice balances; unapplied payments and credit memos are not netted (flagged as a data-quality note and visible in the reconciliation banner).
- The forecast excludes owner distributions, taxes, capex and new borrowing unless entered as one-time items. The AI CFO uses default forecast assumptions, not the user's saved ones.
- Expense change insights show *what* changed, not *why*.
- Single local user, no authentication; token encryption key is stored next to the data unless `FINANCEOS_ENCRYPTION_KEY` is set. Not production-grade security or compliance.
- Development mode can enter a reload loop if the Turbopack cache goes stale after many restarts/edits: `npm run clean`.

## Suggested next steps
1. Connect the real QuickBooks sandbox on Windows; compare FinanceOS P&L/BS/AR with QuickBooks' own reports; fix parser edge cases.
2. Run `npm run eval:ai` on the founder's own hardware (and with `--model qwen3:4b-instruct`) and review the report.
3. Monthly budget editing (not just annual), budget import from CSV, and variance commentary in the management summary.
