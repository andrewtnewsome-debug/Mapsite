# Data folder

## Drop your dataset here: `data/boxoffice.csv`

`python ingest.py` looks for **`data/boxoffice.csv`**. While that file is missing the
pipeline runs on `sample_boxoffice.csv`, a 25-film sample with approximate, widely
reported figures, and the dashboard shows a "Sample data" banner.

### Format

- UTF-8 CSV with a header row. One row per film.
- Money columns are whole US dollars in **nominal** (as-reported, not inflation-adjusted)
  terms. `$1,234,567`, `1234567`, `237M` and `2.9B` are all accepted. Leave a cell blank
  when the figure is unknown; do not write 0 for "unknown".
- People columns take several names separated by semicolons, in billing order. The first
  name is treated as the primary credit: `Anthony Russo; Joe Russo`.
- Column names are case-insensitive. Only `title` and `release_year` (or `release_date`)
  are required; every other column is optional.

| Column | Type | Notes |
|---|---|---|
| `title` | text | required |
| `release_year` | integer | required unless `release_date` is given |
| `release_date` | YYYY-MM-DD | |
| `studio` | text | production company / label, e.g. `Marvel Studios` |
| `distributor` | text | domestic distributor, e.g. `Walt Disney Studios` |
| `genre` | text | primary genre, e.g. `Horror` |
| `genres` | text | all genres, semicolon-separated |
| `mpaa_rating` | text | `G`, `PG`, `PG-13`, `R`, `NC-17`, `NR` |
| `runtime_min` | integer | |
| `production_budget` | dollars | reported budget (often wrong; the UI says so) |
| `opening_weekend_domestic` | dollars | |
| `domestic_gross` | dollars | US + Canada |
| `international_gross` | dollars | derived as worldwide - domestic if blank |
| `worldwide_gross` | dollars | derived as domestic + international if blank |
| `china_gross` | dollars | optional; enables the separate China rental rate |
| `director` | names | semicolon-separated |
| `producers` | names | semicolon-separated |
| `executive_producers` | names | optional, semicolon-separated |
| `lead_cast` | names | top-billed first, semicolon-separated |
| `franchise` | text | franchise or collection name; blank = original |
| `tmdb_id` | integer | optional; speeds up and disambiguates TMDb enrichment |
| `source` | text | optional; where the row's figures came from (shown in the film detail) |
| `franchise_known` | 0 or 1 | optional; 0 = the source has no franchise data, so a blank `franchise` means "unknown", not "original" |

Then rerun:

```
python ingest.py && python build_db.py && python build_dashboard.py
```

No dataset of your own? `python import_public.py` builds this file from two public
datasets (about 1,100 films); see the main README.

## Other files here

- `cpi.csv`: US CPI-U annual averages (BLS series CUUR0000SA0, 1982-84 = 100), used for
  the inflation toggle. Append a row when BLS publishes a new annual average.
- `tmdb_cache/`: cached TMDb responses (only used when `.env` has `TMDB_API_KEY`).
- `conflicts.log`: rewritten on every ingest; lists source disagreements over 10 percent
  and other data problems.
- `staging/movies.json`: ingest output read by `build_db.py`.
