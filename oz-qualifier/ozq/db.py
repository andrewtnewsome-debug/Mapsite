"""SQLite schema for the designation datasets.

Layout:
  datasets             one row per loaded dataset (name, program, vintage, dates, source, counts)
  tracts_<dataset_id>  one table per dataset, keyed by 11-digit tract GEOID; every row is
                       stamped with the dataset name and vintage date
  state_incentives     hand-maintained state program table (see the comment in its DDL)

A new Opportunity Zone round is just another tracts_<id> table plus a datasets row,
both created from data/sources.json by build_data.py, so no code changes are needed.
"""

from __future__ import annotations

import json
import re
import sqlite3
from pathlib import Path
from typing import Iterable, List, Optional

from .paths import DB_PATH

SCHEMA = """
CREATE TABLE IF NOT EXISTS datasets (
    dataset_id            TEXT PRIMARY KEY,
    program               TEXT NOT NULL,      -- QOZ | NMTC | HUBZONE
    name                  TEXT NOT NULL,
    round_label           TEXT,
    authority             TEXT,
    vintage_date          TEXT,               -- publication / data vintage date of the source file
    effective_date        TEXT,               -- designation period start (ISO date) or NULL
    expires_date          TEXT,               -- designation period end (ISO date) or NULL
    expires_by_state_fips TEXT,               -- JSON {state_fips: ISO date} overrides
    period_note           TEXT,
    tract_vintage         TEXT,               -- census tract boundaries the list uses: 2010 | 2020
    geocoder_vintage      TEXT,               -- Census Geocoder vintage that returns matching GEOIDs
    lookup_aliases        TEXT,               -- JSON {county_fips_returned_by_geocoder: county_fips_in_list}
    membership            TEXT,               -- listed | flag
    source_url            TEXT,
    source_page           TEXT,
    source_file           TEXT,
    source_sha256         TEXT,
    row_count             INTEGER,
    qualifying_count      INTEGER,
    is_sample             INTEGER NOT NULL DEFAULT 0,  -- 1 = small test sample, not the official list
    map_url_template      TEXT,
    map_label             TEXT,
    loaded_at             TEXT NOT NULL,
    notes                 TEXT
);

-- state_incentives: HAND-MAINTAINED. This table is a starting point for research, never a
-- complete list of any state's programs. It must be refreshed by hand: open each official_url,
-- confirm the program still exists and the description is right, then update as_of.
-- Source of truth is data/state_incentives.csv; build_data.py reloads it into this table.
CREATE TABLE IF NOT EXISTS state_incentives (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    state         TEXT NOT NULL,     -- two-letter USPS code
    program_name  TEXT NOT NULL,
    program_type  TEXT NOT NULL,     -- e.g. state_oz_conformity, state_oz_credit, state_nmtc, job_creation_credit, ssbci, location_credit
    description   TEXT NOT NULL,     -- one line
    official_url  TEXT NOT NULL,
    notes         TEXT,
    as_of         TEXT NOT NULL      -- date the row was last checked by a person
);
CREATE INDEX IF NOT EXISTS idx_state_incentives_state ON state_incentives(state);
"""

TRACT_TABLE_DDL = """
CREATE TABLE {table} (
    geoid         TEXT PRIMARY KEY CHECK (length(geoid) = 11),
    dataset_name  TEXT NOT NULL,
    vintage_date  TEXT,
    qualifies     INTEGER NOT NULL,     -- 1 = tract meets this designation, 0 = listed but does not
    category      TEXT,                 -- e.g. 'Low-Income Community', 'Non-LIC Contiguous', 'Rural'
    state_name    TEXT,
    county_name   TEXT,
    flags         TEXT,                 -- JSON object, e.g. {{"rural": true}}
    extra         TEXT                  -- JSON object of other source columns
)
"""

_ID_RE = re.compile(r"^[a-z][a-z0-9_]{1,40}$")


def table_name(dataset_id: str) -> str:
    if not _ID_RE.match(dataset_id):
        raise ValueError(f"dataset id {dataset_id!r} must match {_ID_RE.pattern}")
    return f"tracts_{dataset_id}"


def connect(path: Path = DB_PATH) -> sqlite3.Connection:
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path))
    conn.row_factory = sqlite3.Row
    conn.executescript(SCHEMA)
    return conn


def table_exists(conn: sqlite3.Connection, table: str) -> bool:
    return conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (table,)).fetchone() is not None


def datasets(conn: sqlite3.Connection, program: Optional[str] = None) -> List[sqlite3.Row]:
    if program:
        return conn.execute(
            "SELECT * FROM datasets WHERE program=? ORDER BY effective_date, dataset_id", (program,)
        ).fetchall()
    return conn.execute("SELECT * FROM datasets ORDER BY program, effective_date, dataset_id").fetchall()


def lookup_tract(conn: sqlite3.Connection, dataset_id: str, geoid: str) -> Optional[dict]:
    table = table_name(dataset_id)
    if not table_exists(conn, table):
        return None
    row = conn.execute(f"SELECT * FROM {table} WHERE geoid=?", (geoid,)).fetchone()
    if row is None:
        return None
    out = dict(row)
    out["flags"] = json.loads(out["flags"] or "{}")
    out["extra"] = json.loads(out["extra"] or "{}")
    return out


def replace_tract_table(conn: sqlite3.Connection, dataset_id: str, rows: Iterable[tuple]) -> int:
    """Drop and rebuild tracts_<dataset_id> inside one transaction. Returns rows written."""
    table = table_name(dataset_id)
    n = 0
    with conn:
        conn.execute(f"DROP TABLE IF EXISTS {table}")
        conn.execute(TRACT_TABLE_DDL.format(table=table))
        for row in rows:
            conn.execute(
                f"INSERT INTO {table} (geoid, dataset_name, vintage_date, qualifies, category,"
                f" state_name, county_name, flags, extra) VALUES (?,?,?,?,?,?,?,?,?)",
                row,
            )
            n += 1
    return n


def lookup_with_aliases(conn: sqlite3.Connection, ds_row, geoid: str):
    """Look a tract up in one dataset, trying the dataset's county-code aliases if needed.

    Returns (record or None, geoid actually matched, alias description or None).
    """
    rec = lookup_tract(conn, ds_row["dataset_id"], geoid)
    if rec is not None:
        return rec, geoid, None
    aliases = json.loads(ds_row["lookup_aliases"] or "{}") if "lookup_aliases" in ds_row.keys() else {}
    alt_county = aliases.get(geoid[:5])
    if alt_county:
        alt = alt_county + geoid[5:]
        rec = lookup_tract(conn, ds_row["dataset_id"], alt)
        if rec is not None:
            return rec, alt, f"geocoder tract {geoid} matched list tract {alt} (county code {geoid[:5]} is listed as {alt_county})"
    return None, geoid, None
