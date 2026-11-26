"""Step 1 of 3: read the seed dataset, optionally enrich from TMDb, write staging JSON.

    python ingest.py            # normal run
    python ingest.py --no-tmdb  # skip TMDb even if a key is present

Reads data/boxoffice.csv if present. If not, writes data/README.md (what to drop in)
and data/sample_boxoffice.csv (25 well-known films) and uses the sample instead.
Output: data/staging/movies.json, consumed by build_db.py.
"""

from __future__ import annotations

import argparse
import datetime as dt
import re
import sys

from common import (
    BLANK_TOKENS, CONFLICTS_LOG, DATA_DIR, DATA_README, MONEY_FIELDS, PEOPLE_COLUMNS, ROLES, SAMPLE_CSV,
    SEED_CSV, STAGING_JSON, TMDB_CACHE, clean_text, fold, parse_int, parse_money, read_csv_rows,
    read_env, split_names, write_json,
)

CONFLICT_THRESHOLD = 0.10  # sources disagreeing by more than 10% get logged

DATA_README_TEXT = """# Data folder

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
"""


class ConflictLog:
    def __init__(self):
        self.lines: list[str] = []

    def add(self, kind: str, title: str, year, message: str) -> None:
        self.lines.append(f"[{kind}] {title} ({year}): {message}")

    def write(self, header: str) -> None:
        stamp = dt.datetime.now().isoformat(timespec="seconds")
        body = "\n".join(self.lines) if self.lines else "No conflicts."
        CONFLICTS_LOG.write_text(f"# {header}\n# written {stamp}\n{body}\n", encoding="utf-8")


def _split_genres(value) -> list[str]:
    text = clean_text(value)
    if not text:
        return []
    parts = re.split(r"[;|]" if (";" in text or "|" in text) else r",", text)
    seen, out = set(), []
    for part in parts:
        name = " ".join(part.split())
        if name and name.lower() not in seen:
            seen.add(name.lower())
            out.append(name)
    return out


def _pct_diff(a: int, b: int) -> float:
    return abs(a - b) / max(abs(a), abs(b), 1)


def normalize_row(raw: dict, source: str, log: ConflictLog) -> dict | None:
    title = clean_text(raw.get("title"))
    release_date = clean_text(raw.get("release_date"))
    year = parse_int(raw.get("release_year"))
    if year is None and release_date:
        year = parse_int(release_date[:4])
    if not title:
        return None
    if year is None:
        log.add("skipped", title, "?", "no release_year or release_date")
        return None

    genres = _split_genres(raw.get("genres"))
    primary = clean_text(raw.get("genre")) or (genres[0] if genres else None)
    if primary and primary.lower() not in {g.lower() for g in genres}:
        genres.insert(0, primary)

    fin = {field: parse_money(raw.get(field)) for field in MONEY_FIELDS}
    for field in MONEY_FIELDS:
        raw_value = clean_text(raw.get(field))
        if raw_value and fin[field] is None and raw_value.lower().replace("$", "").strip() not in BLANK_TOKENS:
            log.add("data", title, year, f"could not parse {field}={raw_value!r}; stored as missing")
    if fin["production_budget"] == 0:
        fin["production_budget"] = None  # a $0 budget means unknown
    fin["source"] = clean_text(raw.get("source")) or source  # per-row provenance when the CSV has it

    people = {role: [] for role in ROLES}
    for column, role in PEOPLE_COLUMNS.items():
        people[role] = split_names(raw.get(column))

    record = {
        "title": title,
        "release_year": year,
        "release_date": release_date,
        "studio": clean_text(raw.get("studio")),
        "distributor": clean_text(raw.get("distributor")),
        "primary_genre": primary,
        "genres": genres,
        "mpaa_rating": clean_text(raw.get("mpaa_rating")),
        "runtime_min": parse_int(raw.get("runtime_min")),
        "franchise": clean_text(raw.get("franchise")),
        # A blank franchise means "original" unless the row says its source never recorded franchises.
        "franchise_known": bool(clean_text(raw.get("franchise")))
        or (clean_text(raw.get("franchise_known")) or "1").lower() not in ("0", "false", "no"),
        "tmdb_id": parse_int(raw.get("tmdb_id")),
        "financials": fin,
        "people": people,
        "enriched_fields": [],
    }
    reconcile_grosses(record, log)
    return record


def reconcile_grosses(record: dict, log: ConflictLog) -> None:
    """Fill a missing gross from the other two and flag internal inconsistencies."""
    fin, title, year = record["financials"], record["title"], record["release_year"]
    dom, intl, ww = fin["domestic_gross"], fin["international_gross"], fin["worldwide_gross"]
    if ww is None and dom is not None and intl is not None:
        fin["worldwide_gross"] = dom + intl
    elif intl is None and ww is not None and dom is not None and ww >= dom:
        fin["international_gross"] = ww - dom
    elif dom is None and ww is not None and intl is not None and ww >= intl:
        fin["domestic_gross"] = ww - intl
    elif None not in (dom, intl, ww) and _pct_diff(dom + intl, ww) > 0.01:
        log.add("internal", title, year,
                f"domestic + international = {dom + intl:,} but worldwide = {ww:,}; kept as given")
    china, intl = fin.get("china_gross"), fin["international_gross"]
    if china is not None and intl is not None and china > intl:
        log.add("internal", title, year, f"china_gross {china:,} exceeds international {intl:,}; China split ignored")
        fin["china_gross"] = None


def merge_tmdb(record: dict, info: dict, log: ConflictLog) -> None:
    """Fill gaps from TMDb. Never overwrites seed values; logs >10% financial disagreements."""
    title, year, fin = record["title"], record["release_year"], record["financials"]
    filled = record["enriched_fields"]

    for field in ("production_budget", "worldwide_gross"):
        theirs, ours = info.get(field), fin.get(field)
        if theirs is None:
            continue  # never overwrite with a null
        if ours is None:
            fin[field] = int(theirs)
            filled.append(field)
        elif _pct_diff(ours, theirs) > CONFLICT_THRESHOLD:
            log.add("conflict", title, year,
                    f"{field}: seed {ours:,} vs TMDb {int(theirs):,} "
                    f"({_pct_diff(ours, theirs):.0%} apart); kept seed value")
    if "worldwide_gross" in filled:
        reconcile_grosses(record, log)

    for field in ("runtime_min", "mpaa_rating", "franchise", "release_date", "studio"):
        if record.get(field) in (None, "") and info.get(field):
            record[field] = info[field]
            filled.append(field)
    if not record.get("franchise_known"):
        record["franchise_known"] = True  # TMDb answered: no collection means an original
        filled.append("franchise_known")
    if not record["genres"] and info.get("genres"):
        record["genres"] = list(info["genres"])
        record["primary_genre"] = record["primary_genre"] or info["genres"][0]
        filled.append("genres")
    for role, names in (info.get("people") or {}).items():
        if names and not record["people"].get(role):
            record["people"][role] = list(names)
            filled.append(f"people.{role}")
    if filled:
        fin["source"] = f"{fin['source']}+tmdb"


def enrich(records: list[dict], api_key: str, log: ConflictLog) -> dict:
    from tmdb import TMDbClient, extract

    client = TMDbClient(api_key, TMDB_CACHE)
    enriched = 0
    for record in records:
        if client.offline and not record.get("tmdb_id"):
            continue
        tmdb_id = record.get("tmdb_id") or client.search_movie(record["title"], record["release_year"])
        if not tmdb_id:
            continue
        details = client.movie(tmdb_id)
        if not details:
            continue
        record["tmdb_id"] = tmdb_id
        before = len(record["enriched_fields"])
        merge_tmdb(record, extract(details), log)
        enriched += len(record["enriched_fields"]) > before
    return {"films_with_new_fields": enriched, **client.stats, "offline": client.offline}


def load_seed(log: ConflictLog) -> tuple[list[dict], dict]:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    if SEED_CSV.exists():
        source, path = "seed", SEED_CSV
    else:
        from sample_data import write_sample_csv

        if not DATA_README.exists():
            DATA_README.write_text(DATA_README_TEXT, encoding="utf-8")
            print(f"  wrote {DATA_README.relative_to(DATA_DIR.parent)} (what to drop in)")
        count = write_sample_csv(SAMPLE_CSV)
        print(f"  data/boxoffice.csv not found; using the {count}-film sample "
              f"({SAMPLE_CSV.relative_to(DATA_DIR.parent)})")
        source, path = "sample", SAMPLE_CSV

    records, seen = [], {}
    for raw in read_csv_rows(path):
        row_log = ConflictLog()  # only keep this row's warnings if the row itself is kept
        record = normalize_row(raw, source, row_log)
        if record is None:
            log.lines.extend(row_log.lines)
            continue
        key = (fold(record["title"]), record["release_year"])
        if key in seen:
            log.add("duplicate", record["title"], record["release_year"], "duplicate row ignored (first row kept)")
            continue
        seen[key] = True
        log.lines.extend(row_log.lines)
        records.append(record)
    return records, {"source": source, "file": str(path.relative_to(DATA_DIR.parent))}


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--no-tmdb", action="store_true", help="skip TMDb enrichment")
    args = parser.parse_args(argv)

    print("ingest: reading seed data")
    log = ConflictLog()
    records, dataset = load_seed(log)
    print(f"  {len(records)} films from {dataset['file']}")

    api_key = read_env().get("TMDB_API_KEY", "")
    tmdb_stats = None
    if args.no_tmdb:
        print("  TMDb enrichment skipped (--no-tmdb)")
    elif not api_key:
        print("  no TMDB_API_KEY in .env; skipping enrichment")
    else:
        print("  enriching from TMDb (cached in data/tmdb_cache/)")
        tmdb_stats = enrich(records, api_key, log)
        print(f"  TMDb: {tmdb_stats['fetched']} fetched, {tmdb_stats['cache_hits']} from cache, "
              f"{tmdb_stats['films_with_new_fields']} films gained fields"
              + (" (API unreachable; partial)" if tmdb_stats["offline"] else ""))

    dataset.update({
        "film_count": len(records),
        "tmdb_enriched": bool(tmdb_stats and tmdb_stats["films_with_new_fields"]),
        "ingested_at": dt.datetime.now().isoformat(timespec="seconds"),
    })
    write_json(STAGING_JSON, {"dataset": dataset, "movies": records})
    log.write(f"ingest conflicts for {dataset['file']}")
    print(f"  wrote {STAGING_JSON.relative_to(DATA_DIR.parent)}; "
          f"{len(log.lines)} issue(s) logged to {CONFLICTS_LOG.relative_to(DATA_DIR.parent)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
