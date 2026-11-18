# FinanceOS Product Roadmap

From local prototype to a commercial AI finance employee for small and lower-middle-market businesses.

> The current prototype is **not** production-ready. It runs on one computer, uses a QuickBooks **sandbox**, has no user authentication, and does not provide production-grade data protection or regulatory compliance. This document describes what would be required to serve paying customers.

---

## 1. Where the prototype stands

**Built and reusable as-is or with hardening**
- Source-independent financial data model and a deterministic, tested calculation engine (aging, statements, ratios, 13-week forecast, insights, collections scoring).
- "Calculate, then explain, then verify" AI architecture: deterministic tools, constrained prompts, a number guard that flags any figure the model did not receive.
- QuickBooks Online integration patterns: OAuth with signed single-use state, token refresh with rotation, paginated read-only client, report parsing, partial-failure handling.
- Product surface: dashboard, AR, cash forecast, profitability, reports, collections and invoice assistants, insights.
- Seams for commercialization: request context with tenant/user/role, permission checks on every API route, audit events, per-company data scoping.

**Prototype-only shortcuts to replace**
- JSON files on disk → managed database. Local encryption key → managed key service. Single implicit user → real authentication. Local Ollama → hosted private inference. Sandbox → production Intuit app (requires Intuit review).

---

## 2. Phased plan

### Phase A — Design partners (0–3 months)
Goal: 5–10 real businesses using FinanceOS weekly with an advisor in the loop.
- Production Intuit app: pass Intuit's app review and security questionnaire; production keys; privacy policy, terms, end-user license.
- Accounts and authentication (email + MFA, or SSO via a provider such as WorkOS/Auth0/Clerk); session management; account recovery.
- Multi-tenant Postgres (row-level security by `tenant_id`), migrations, backups, point-in-time recovery.
- Background sync jobs (queue + scheduler), webhooks from Intuit for change data capture, incremental sync instead of full re-pull.
- Hosted private inference (see §4). Evaluation harness for the AI CFO with a fixed question set, expected tools and figure-accuracy scoring; regression tests on every model or prompt change.
- Observability: structured logs without financial payloads, error tracking, uptime monitoring.
- Customer onboarding: connect QuickBooks, confirm chart-of-accounts mapping (payroll accounts, owner draws, debt), set minimum cash and payroll schedule.

### Phase B — Paid product (3–9 months)
Goal: self-serve subscriptions for owner-operated businesses; recurring revenue.
- Subscription billing (Stripe Billing): plans, trials, invoices, dunning, tax.
- Roles: owner, controller/bookkeeper, advisor (read-only), investor (portfolio view). The prototype's `can(ctx, action)` model becomes database-backed.
- Additional integrations behind the same canonical model: Xero, NetSuite (mid-market), Gusto/ADP (actual payroll calendars), bill.com, and bank connectivity (Plaid or similar) for **real** cash balances and transaction categorization. Clearly separate bank balances from book balances.
- Close-the-loop automation with permissioned actions: send approved collection emails from the customer's own mailbox (OAuth to Gmail/Microsoft 365), create draft invoices in QuickBooks after explicit approval, schedule follow-ups. Every write action: preview → approval → execution → audit record → undo where possible.
- Budget vs. actual, cash forecast saved scenarios and variance tracking (forecast vs. what happened), weekly CFO briefing by email.

### Phase C — Advisor and portfolio platform (9–18 months)
Goal: sell to fractional CFO firms, accounting firms and PE/independent sponsors managing many companies.
- Portfolio dashboards across companies (the canonical model already makes cross-company roll-ups straightforward): cash, AR health, covenant headroom, KPI benchmarks.
- Covenant tracking from credit agreements, lender reporting packages, board/IC-ready monthly packages.
- White-labeling for advisors; client workspaces; per-client permissions.
- Industry modules (construction WIP and retainage, field services job costing, professional services utilization).

---

## 3. Security and compliance requirements

| Area | Required before paying customers |
| --- | --- |
| Data protection | Encryption in transit (TLS) and at rest (database + backups); managed keys (AWS KMS/GCP KMS) with rotation; secrets in a vault; no financial data in logs. |
| Access control | Authentication with MFA, least-privilege roles, tenant isolation enforced in the database (RLS) and tested, admin access logging. |
| Audit | Immutable audit log of logins, connections, syncs, AI questions (metadata), approvals and every write action. |
| Application security | Threat model, dependency scanning, SAST, third-party penetration test, responsible disclosure policy. |
| Compliance | SOC 2 Type I then Type II (security, availability, confidentiality); Intuit app security review; GLBA-aware privacy practices for financial data; data processing agreements; data retention and deletion policy; state privacy laws (e.g. CCPA). |
| AI governance | Documented model inventory, no training on customer data, prompt/response retention policy, evaluation results per release, clear labeling of AI interpretation vs. verified figures (already in the product). |
| Business continuity | Backups with tested restore, incident response plan, status page. |

---

## 4. AI strategy

- **Keep the core principle**: the model explains, code computes. Expand the tool library rather than letting the model do arithmetic.
- **Inference options** (in order of data-control): self-hosted open models on dedicated GPUs in the company's cloud account; a private deployment of a commercial model with zero data retention and no training on customer data; local inference for privacy-sensitive customers (as in the prototype).
- **Quality**: evaluation sets per question type, automated figure-accuracy checks (the number guard becomes a release gate), human review of a sample of answers, monitoring of "unverified figure" rates in production.
- **Capabilities next**: variance explanations grounded in transaction-level drill-down ("which vendors drove the subcontractor increase"), anomaly detection on transactions, natural-language report building, proactive weekly briefings.

---

## 5. Go-to-market

- **Initial customer**: owner-operated services, construction and facilities businesses with $1M–$30M revenue, on QuickBooks Online, without a full-time CFO.
- **Channels**: fractional CFO and bookkeeping firms (one advisor brings many companies), PE operating partners and independent sponsors (portfolio monitoring), QuickBooks App Store listing.
- **Pricing hypothesis**: per company per month, tiered by revenue band and modules (e.g. Core: dashboard, AR, forecast, AI CFO; Plus: collections and invoice automation, integrations; Advisor/Portfolio: multi-company and white-label). Validate with design partners before publishing.
- **Proof points to collect**: days sales outstanding reduction, time saved on month-end and weekly cash reviews, forecast accuracy over 13 weeks, owner engagement (questions asked per week).

---

## 6. Team and budget (indicative)

- First hires: senior full-stack engineer (TypeScript/Postgres), data/integrations engineer (accounting APIs), part-time security/compliance lead or vCISO, an accountant/controller advisor to validate calculations.
- Recurring costs that start at commercialization: cloud hosting and database, inference (GPU or private model API), monitoring, email delivery, auth provider, SOC 2 audit and tooling, penetration testing, legal (terms, privacy, DPAs).

---

## 7. Immediate next steps (this repository)

1. Connect a real QuickBooks sandbox and reconcile FinanceOS reports with QuickBooks' own reports; fix parser edge cases.
2. Run the AI CFO with `qwen3:4b` locally; build the evaluation harness; measure guard pass rate.
3. Recruit 3–5 design partners using their sandbox-mirrored or exported data under NDA, without production credentials, to validate the questions owners ask most.
4. Write the production architecture decision records (database, auth, inference hosting) before building Phase A.
