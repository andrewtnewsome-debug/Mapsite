# MAP Lab Center: Capital Raise Portal (clickable prototype)

Runs entirely on your computer. No accounts, API keys, or database needed.

## Run it

Requires Node.js 20 or newer (https://nodejs.org).

```bash
cd portal && npm install && npm run dev
```

Then open **http://localhost:3000**.

## What's in it

| Page | What it shows |
| --- | --- |
| `/` | Public landing page |
| `/apply` | 4-step submission form (use **Fill sample answers** to click through quickly). Acquisitions ask about the buyer, with a "Do you currently own a business?" toggle, and accept a CIM upload |
| `/team` | Team view: every submission with fit score, NAICS code, top match, status |
| `/team/submissions/[id]` | Deal summary, fit score breakdown, matched providers, status, notes |
| `/team/providers` | The 43 capital providers, their criteria, research notes and sources |

## Reading a CIM with Claude

On the "Business you're buying" (or "About the company") step, applicants can upload a CIM as a PDF.
`app/api/cim/route.ts` sends it to Claude, which returns the company details, financials, purchase terms,
industry code, a summary, key facts and risks; the form is pre-filled and every value says which page it came from.
The deal page then shows the CIM findings and flags any figure the applicant changed.

This needs an API key: create `portal/.env.local` with `ANTHROPIC_API_KEY=...` and restart. Without it the upload
explains that CIM reading isn't connected and the form works by hand. The instructions Claude follows are in `lib/cim.ts`.

## Real vs. placeholder

- **Real (rules):** fit scoring (`lib/scoring.ts`) and provider matching (`lib/matching.ts`).
- **Claude, when a CIM is uploaded:** the deal summary and NAICS code come from Claude's reading of the CIM.
- **Placeholder otherwise:** the templated summary (`lib/summary.ts`) and keyword NAICS classifier (`lib/naics.ts`),
  marked "AI draft · placeholder" in the UI.
- **Add-on acquisitions** (the buyer owns a business and will combine it with the target) are scored and matched
  on combined figures; see `underwriting()` in `lib/scoring.ts`.
- **Not wired yet:** login (Supabase Auth), emails (Resend).

## Data

- Sample data lives in `data/seed.json` (10 sample submissions, 43 capital providers).
- Providers come from the Minority Business Investor Database workbook. To load an updated version:
  `python3 scripts/import_providers.py path/to/workbook.xlsx` (needs `pip install openpyxl`).
  The workbook describes capital types, uses of funds, industries and states in prose; `MAPPING` in that
  script turns them into matching rules, and each provider page lists those interpretations.
- Blank amounts in the workbook mean "not published." Matching treats them as "to confirm," never as a pass or a fail.
- Changes you make are saved to `data/db.json`, which is created on first run.
- `npm run reset-data` deletes it so the next page load starts fresh from the seed.
- All storage goes through `lib/db.ts`; that is the one file that changes when Supabase is connected.
