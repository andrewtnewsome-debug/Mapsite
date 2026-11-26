# Movie profitability analytics

A local, offline tool for one question: **what kinds of movies actually make money?**
It compares production budget with box office, puts an explicit theatrical profit model
on top, and lets you slice the results by genre, studio, distributor, year, budget tier,
rating, franchise status and people (director, producer, executive producer, lead cast).

Python standard library only (3.9+), SQLite, and a static HTML dashboard with hand-rolled
SVG charts. No server, no build step, no CDN or network calls.

## Run it

```bash
python ingest.py           # seed CSV (+ optional TMDb enrichment) -> data/staging/movies.json
python build_db.py         # -> movies.db, with a verification report
python build_dashboard.py  # -> dashboard/data/movies.json + dashboard/index.html
```

Then open `dashboard/index.html` in a browser, straight from disk. The page is
self-contained: data, model and charts are inlined, so it also works when emailed or
copied elsewhere.

Without `data/boxoffice.csv` the pipeline runs on a 25-film sample
(`data/sample_boxoffice.csv`) and the dashboard shows a "Sample data" banner.

## Add the real dataset

Save it as **`data/boxoffice.csv`** and rerun the three commands. `data/README.md` lists
every column; in short:

- One row per film with a header row. Only `title` and `release_year` (or `release_date`)
  are required.
- Money in whole **nominal** US dollars (`$1,234,567`, `1234567`, `237M`, `2.9B` all work).
  Leave unknown figures blank, never 0.
- People columns (`director`, `producers`, `executive_producers`, `lead_cast`) take several
  names separated by semicolons, in billing order. The first name is the primary credit.
- Optional `china_gross` turns on the separate China rental rate for that film.
- Missing grosses are derived where possible (international = worldwide - domestic, and so
  on). Problems such as unparseable values, duplicates and inconsistent totals go to
  `data/conflicts.log`.

`data/boxoffice.csv` is git-ignored because commercial box office data is usually
licensed. Remove that line from `.gitignore` if you are free to commit it. Note that
`dashboard/index.html` and `dashboard/data/movies.json` embed whatever dataset you build.

## Add a TMDb key (optional)

```bash
cp .env.example .env   # then set TMDB_API_KEY=...
python ingest.py
```

Both a v3 API key and a v4 read-access token work. For each film, ingest uses `tmdb_id`
from the CSV or searches by title and year, then fetches details, credits and US release
certifications in one call. It fills gaps only:

- genres, runtime, MPAA rating, franchise (TMDb collection), studio, release date;
- director (crew job *Director*), producers (*Producer*) and executive producers
  (*Executive Producer*) stored as separate roles, and the top 3 billed cast;
- budget and worldwide gross, only where the seed value is blank.

Rules: a non-null seed value is never replaced, and never by a null. If TMDb and the seed
disagree on budget or worldwide gross by more than 10 percent, the seed value is kept and
the disagreement is written to `data/conflicts.log`. Every response, including empty
search results, is cached in `data/tmdb_cache/`, so no film is fetched twice. If the API
is unreachable or rejects the key, ingest stops calling it, keeps using the cache, and
finishes normally. `python ingest.py --no-tmdb` skips enrichment entirely.

## The profit model

Box office gross minus budget is not profit: theaters keep roughly half the gross, and
marketing costs about as much as a mid-budget film. Every assumption lives in
`config/assumptions.json`.

| Step | Default |
|---|---|
| **Rentals** (studio share of gross) | 52% of domestic; 40% of international. Where a China split exists: 40% of international ex-China and 25% of China. Films with only a worldwide figure: 45% of it. |
| **P&A** (prints and advertising) by budget tier | Under $10M: 50% of budget. $10M to $40M: $12M. Over $40M to $100M: $25M. Over $100M to $200M: $40M. Over $200M: $55M. |
| **Estimated theatrical profit** | rentals - production budget - P&A |
| **Estimated ROI** | profit / (budget + P&A) |
| **Gross multiple** | worldwide gross / budget |
| **Breakeven multiple** | the gross multiple at which rentals cover budget + P&A, at the film's own domestic/international mix |
| **Opening multiplier** ("legs") | domestic gross / opening weekend |

**Tier boundaries.** "Under $10M" excludes exactly $10M. The other tiers include their
upper bound, so a $200M film is in the $100M to $200M tier. Each tier's `max_inclusive`
flag controls this.

**Tiers are in today's dollars by default** (`"pa_tiers_basis": "real"`). A film's budget
is converted to latest-CPI-year dollars to choose its tier. The flat P&A amounts are read
as latest-year dollars and deflated back to the release year. Without this, *E.T.*
($10.5M in 1982) would be charged a $12M marketing spend, more than its budget. Set the
basis to `"nominal"` to apply the tiers to reported budgets as they stand.

**Worked example: *Black Panther* (2018), sample data.**

```
rentals  = 700,059,566 x 52%                    = 364,030,974.32  domestic
         + (646,853,595 - 105,000,000) x 40%    = 216,741,438.00  international ex-China
         + 105,000,000 x 25%                    =  26,250,000.00  China
                                                = 607,022,412.32
CPI 2018 -> 2024 = 313.689 / 251.107 = 1.249225
budget in 2024 $ = 200M x 1.249225 = 249.8M      -> "Over $200M" tier, $55M in 2024 $
P&A in 2018 $    = 55,000,000 / 1.249225        =  44,027,316.86
profit           = 607,022,412.32 - 200,000,000 - 44,027,316.86 = 362,995,095.46
ROI              = 362,995,095.46 / 244,027,316.86 = +148.8%
gross multiple   = 1,346,913,161 / 200,000,000  = 6.73x
breakeven        = 244,027,316.86 / (607,022,412.32 / 1,346,913,161) / 200M = 2.71x
```

`tests/test_profit_model.py` checks the code against this arithmetic.

### Changing assumptions

- **In the browser:** the *Assumptions* tab edits rental rates, tier bounds, tier
  amounts and the tier basis. Every figure and chart recomputes immediately, including the
  scatter's breakeven line. Edits are remembered in that browser only and are labelled
  "Custom assumptions" wherever profit appears. *Download assumptions.json* saves them as
  a file.
- **As the default:** edit or replace `config/assumptions.json`, then rerun
  `python build_dashboard.py`. No re-ingest or database rebuild is needed.

The dashboard runs a JavaScript port of the model (`dashboard_src/model.js`).
`tests/test_js_parity.py` checks that it matches the Python model on every film and
every metric.

### Limits: read before drawing conclusions

- **Theatrical estimate only.** It excludes streaming, home entertainment, TV licensing,
  merchandising, participations and residuals. For many films those exceed theatrical
  profit, and participations can turn an apparent hit into an accounting loss.
- **Budgets are reported figures and are often wrong.** They come from studios and the
  trade press, are usually understated, and exclude marketing. Tax incentives are rarely
  netted out. Every multiple and ROI inherits that error, so the UI flags budgets wherever
  they appear.
- **Rental rates are averages.** Real splits vary by film, territory, distributor, run
  length and contract. Fixed rates overstate rentals for weak openers and understate them
  for long-running hits.
- **P&A is a tier lookup, not actual spend.** Real campaigns for the biggest films run
  past $100M.
- **Lifetime grosses include re-releases** where the source does. *Avatar* and *Titanic*
  look better than their original runs did.
- **Franchise means "belongs to a named series"**, including series starters such as
  *Star Wars* (1977). The franchise-vs-original comparison therefore partly rewards the
  originals that succeeded enough to become franchises.
- **Legs** is distorted by limited or platform openings (*Paranormal Activity*,
  *Fruitvale Station*).
- **Inflation** uses US CPI-U for worldwide money. Films released after the last CPI year
  in `data/cpi.csv` (2024) are treated as already being in 2024 dollars.

## Dashboard

- **Overview strip:** film count, median gross multiple, median estimated ROI, and share
  estimated profitable, all computed from the active filters.
- **Filters:** release-year range, genre (matches any listed genre), studio or
  distributor, budget tier, MPAA rating, franchise or original, minimum worldwide gross,
  hide budgets under $1M, and searchable director, producer, executive producer and lead
  actor pickers. Every filter applies to every chart and table, the leaderboard included.
  Filter state is kept in the URL hash, so a view can be bookmarked, for example
  `index.html#dir=Ryan%20Coogler&tab=all`.
- **Scatter:** reported budget against worldwide gross on log scales, coloured by primary
  genre. Hollow dots are films estimated as unprofitable. The dashed breakeven line uses
  the current assumptions and the median domestic share of the films shown. Click a dot
  to open the film; click a legend entry to isolate a genre.
- **Median ROI by group:** switch between genre, studio, distributor, decade, budget
  tier, MPAA rating and franchise status. When one group's median dwarfs the rest, its
  bar is cut at a break mark so the other bars stay readable. A table view is available.
- **Median gross multiple by release year:** log scale, with the median breakeven
  multiple as a reference line.
- **Films table:** top 25 and bottom 25 by estimated ROI, limited to budgets of at least
  $1M (configurable), or all films. Every column sorts.
- **Movie detail:** all reported figures, the profit waterfall (gross, theaters' share,
  rentals, budget, P&A, profit) with the arithmetic, percentile ranks within the film's
  primary genre and decade, and clickable credits.
- **People leaderboard:** director, producer, executive producer or lead actor, ranked by
  film count, median gross multiple, median ROI, total estimated profit and share
  profitable. The minimum film count defaults to 3. Click a name to filter the dashboard
  to that person's filmography.
- **Inflation toggle:** nominal dollars, or every dollar figure in latest-CPI-year
  dollars. Ratios (multiples, ROI) do not change, because budgets and grosses scale
  together.

## Tests

```bash
python -m pytest tests          # or: python -m unittest discover tests
node tests/e2e_dashboard.js     # browser checks; needs Node.js + the playwright package
```

- `test_profit_model.py`: tier boundaries, rental methods, the hand-computed film,
  inflation and validation.
- `test_pipeline.py`: CSV parsing, merge and conflict rules, TMDb caching and failure
  handling (mocked), and loading the database.
- `test_js_parity.py`: the browser model matches the Python model. Skipped without
  Node.js.
- `test_dashboard_e2e.py`, which runs `e2e_dashboard.js`, checks that:
  - a filter changes the overview strip;
  - the breakeven line moves when an assumption changes;
  - the Ryan Coogler director filter returns exactly his five films, with economics equal
    to the Python model's;
  - he appears in the director leaderboard;
  - the inflation toggle, detail view, sorting and phone width all work;
  - the page makes no network requests.

  Skipped without Playwright.

## Layout

```
ingest.py            seed CSV / sample -> TMDb enrichment -> data/staging/movies.json
build_db.py          staging JSON -> movies.db (+ verification)
build_dashboard.py   movies.db -> dashboard/data/movies.json + dashboard/index.html
profit_model.py      the profit model (tested)
common.py            paths and parsing helpers
sample_data.py       the 25-film sample
tmdb.py              TMDb client with on-disk cache
config/assumptions.json
data/                cpi.csv, README.md (dataset format), sample, cache, conflicts.log
dashboard_src/       index.html template, style.css, model.js, app.js
dashboard/           generated output: open index.html
tests/
```

## Database schema

| Table | Columns |
|---|---|
| `movies` | id, title, release_year, release_date, studio, distributor, primary_genre, mpaa_rating, runtime_min, franchise (NULL = original), tmdb_id |
| `financials` | movie_id, production_budget, opening_weekend_domestic, domestic_gross, international_gross, worldwide_gross, china_gross, source |
| `genres` | movie_id, genre (one row per genre per film) |
| `people` | movie_id, person_name, role (`director` / `producer` / `executive_producer` / `lead_cast`), billing_order (1 = first listed) |
| `meta` | key, value (dataset source, ingest time) |

### Schema notes

- Money is stored as integer **nominal** US dollars. The release year lets inflation be
  applied at display time from `data/cpi.csv`. Negative values are rejected by CHECK
  constraints, and ingest stores unparseable or negative input as NULL.
- `china_gross` is an addition to the original spec. It is nullable and only used to apply
  the separate China rental rate.
- `financials.source` is `seed` or `sample`, with `+tmdb` appended when TMDb filled any
  gap.
- A person with two roles on one film (Ryan Coogler directed and produced *Sinners*) has
  two `people` rows.
- **Placeholder, not built in v1:** `financials.ancillary_revenue_estimate` (INTEGER,
  nullable), for streaming, home entertainment, TV licensing and merchandising. It is
  deliberately absent from the schema and the model until there is a defensible source
  for it.
