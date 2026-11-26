"""Step 2 of 3: load data/staging/movies.json into a fresh SQLite database, movies.db.

    python build_db.py

Rebuilds movies.db from scratch each run, then prints a verification report:
row counts, a negative-money check, and a spot check of five films against the
source CSV.
"""

from __future__ import annotations

import sqlite3
import sys

from common import DB_PATH, MONEY_FIELDS, ROOT, ROLES, STAGING_JSON, fold, load_json, parse_int, parse_money, read_csv_rows

SCHEMA = """
CREATE TABLE movies (
    id              INTEGER PRIMARY KEY,
    title           TEXT    NOT NULL,
    release_year    INTEGER NOT NULL,
    release_date    TEXT,
    studio          TEXT,
    distributor     TEXT,
    primary_genre   TEXT,
    mpaa_rating     TEXT,
    runtime_min     INTEGER,
    franchise       TEXT,              -- NULL = original
    tmdb_id         INTEGER
);

-- Money is stored as integer nominal US dollars. Inflation is applied at display time
-- from data/cpi.csv using movies.release_year.
CREATE TABLE financials (
    movie_id                 INTEGER PRIMARY KEY REFERENCES movies(id),
    production_budget        INTEGER CHECK (production_budget >= 0),
    opening_weekend_domestic INTEGER CHECK (opening_weekend_domestic >= 0),
    domestic_gross           INTEGER CHECK (domestic_gross >= 0),
    international_gross      INTEGER CHECK (international_gross >= 0),
    worldwide_gross          INTEGER CHECK (worldwide_gross >= 0),
    china_gross              INTEGER CHECK (china_gross >= 0),  -- optional China split
    source                   TEXT NOT NULL                       -- seed | sample, '+tmdb' if gaps were filled
);

CREATE TABLE genres (
    movie_id INTEGER NOT NULL REFERENCES movies(id),
    genre    TEXT    NOT NULL,
    PRIMARY KEY (movie_id, genre)
);

CREATE TABLE people (
    movie_id      INTEGER NOT NULL REFERENCES movies(id),
    person_name   TEXT    NOT NULL,
    role          TEXT    NOT NULL CHECK (role IN ('director', 'producer', 'executive_producer', 'lead_cast')),
    billing_order INTEGER,                -- 1 = first listed (primary credit)
    PRIMARY KEY (movie_id, person_name, role)
);
CREATE INDEX people_by_name ON people (person_name, role);

CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
"""

SPOT_CHECK_TITLES = ["Avatar", "Get Out", "John Carter", "Black Panther", "Paranormal Activity"]


def build(staging: dict, db_path=DB_PATH) -> sqlite3.Connection:
    if db_path != ":memory:" and db_path.exists():
        db_path.unlink()
    conn = sqlite3.connect(db_path if db_path == ":memory:" else str(db_path))
    conn.executescript(SCHEMA)
    for movie_id, m in enumerate(staging["movies"], start=1):
        conn.execute(
            "INSERT INTO movies VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (movie_id, m["title"], m["release_year"], m["release_date"], m["studio"], m["distributor"],
             m["primary_genre"], m["mpaa_rating"], m["runtime_min"], m["franchise"], m["tmdb_id"]),
        )
        fin = m["financials"]
        conn.execute(
            "INSERT INTO financials VALUES (?,?,?,?,?,?,?,?)",
            (movie_id, *(fin.get(f) for f in MONEY_FIELDS), fin["source"]),
        )
        for genre in m["genres"]:
            conn.execute("INSERT OR IGNORE INTO genres VALUES (?,?)", (movie_id, genre))
        for role in ROLES:
            for order, name in enumerate(m["people"].get(role) or [], start=1):
                conn.execute("INSERT OR IGNORE INTO people VALUES (?,?,?,?)", (movie_id, name, role, order))
    for key, value in staging["dataset"].items():
        conn.execute("INSERT INTO meta VALUES (?,?)", (key, str(value)))
    conn.commit()
    return conn


def verify(conn: sqlite3.Connection, source_csv) -> list[str]:
    """Return a list of failures (empty = all good) and print the report."""
    failures: list[str] = []
    counts = {t: conn.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
              for t in ("movies", "financials", "genres", "people")}
    print("  row counts: " + ", ".join(f"{t}={n}" for t, n in counts.items()))
    if counts["movies"] != counts["financials"]:
        failures.append("movies and financials row counts differ")
    by_role = conn.execute("SELECT role, COUNT(*) FROM people GROUP BY role ORDER BY role").fetchall()
    print("  people by role: " + ", ".join(f"{r}={n}" for r, n in by_role))

    negatives = conn.execute(
        "SELECT COUNT(*) FROM financials WHERE " + " OR ".join(f"{f} < 0" for f in MONEY_FIELDS)
    ).fetchone()[0]
    print(f"  negative money values: {negatives}")
    if negatives:
        failures.append(f"{negatives} rows with negative money")
    missing = conn.execute(
        "SELECT SUM(production_budget IS NULL), SUM(worldwide_gross IS NULL) FROM financials"
    ).fetchone()
    print(f"  missing budget: {missing[0] or 0}, missing worldwide gross: {missing[1] or 0}")

    if source_csv and source_csv.exists():
        rows: dict = {}
        for r in read_csv_rows(source_csv):  # first occurrence wins, as in ingest
            year = parse_int(r.get("release_year")) or parse_int((r.get("release_date") or "")[:4])
            rows.setdefault((fold(r.get("title") or ""), year), r)
        db_rows = conn.execute(
            "SELECT m.title, m.release_year, f.production_budget, f.domestic_gross, f.worldwide_gross "
            "FROM movies m JOIN financials f ON f.movie_id = m.id"
        ).fetchall()
        picks = [r for r in db_rows if r[0] in SPOT_CHECK_TITLES] or db_rows[:5]
        fields = ("production_budget", "domestic_gross", "worldwide_gross")
        show = lambda v: f"{v:,}" if v is not None else "—"
        print(f"  spot check vs {source_csv.name} (seed values must survive unchanged; '+' = filled by "
              f"derivation or TMDb):")
        for title, year, *values in picks[:5]:
            src = rows.get((fold(title), year))
            if not src:
                failures.append(f"{title} not found in source CSV")
                continue
            expected = [parse_money(src.get(f)) for f in fields]
            bad = [f for f, e, v in zip(fields, expected, values) if e is not None and e != v]
            marks = ["+" if e is None and v is not None else "" for e, v in zip(expected, values)]
            print(f"    {'BAD' if bad else 'OK '} {title} ({year}): budget {show(values[0])}{marks[0]}  "
                  f"domestic {show(values[1])}{marks[1]}  worldwide {show(values[2])}{marks[2]}")
            if bad:
                failures.append(f"{title}: {', '.join(bad)} differ from the source CSV")
    return failures


def main() -> int:
    if not STAGING_JSON.exists():
        print("build_db: data/staging/movies.json not found. Run `python ingest.py` first.")
        return 1
    staging = load_json(STAGING_JSON)
    print(f"build_db: loading {len(staging['movies'])} films into {DB_PATH.name}")
    conn = build(staging)
    source_csv = ROOT / staging["dataset"]["file"]
    failures = verify(conn, source_csv)
    conn.close()
    if failures:
        print("  VERIFICATION FAILED:\n    " + "\n    ".join(failures))
        return 1
    print("  verification passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
