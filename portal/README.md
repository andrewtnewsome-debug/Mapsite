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
| `/apply` | 4-step submission form (use **Fill sample answers** to click through quickly) |
| `/team` | Team view: every submission with fit score, NAICS code, top match, status |
| `/team/submissions/[id]` | Deal summary, fit score breakdown, matched providers, status, notes |
| `/team/providers` | The 15 capital providers and their criteria |

## Real vs. placeholder

- **Real (rules):** fit scoring (`lib/scoring.ts`) and provider matching (`lib/matching.ts`).
- **Placeholder:** the AI deal summary (`lib/summary.ts`) and NAICS classification (`lib/naics.ts`).
  Both are marked "AI draft · placeholder" in the UI and get replaced by Claude in Phase 1.
- **Not wired yet:** login (Supabase Auth), emails (Resend).

## Data

- Sample data lives in `data/seed.json` (10 submissions, 15 providers).
- Changes you make are saved to `data/db.json`, which is created on first run.
- `npm run reset-data` deletes it so the next page load starts fresh from the seed.
- All storage goes through `lib/db.ts`; that is the one file that changes when Supabase is connected.
