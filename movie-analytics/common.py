"""Shared paths and parsing helpers for the movie analytics pipeline."""

from __future__ import annotations

import csv
import json
import os
import re
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
CONFIG_DIR = ROOT / "config"
DASHBOARD_DIR = ROOT / "dashboard"
DASHBOARD_SRC = ROOT / "dashboard_src"

SEED_CSV = DATA_DIR / "boxoffice.csv"
SAMPLE_CSV = DATA_DIR / "sample_boxoffice.csv"
DATA_README = DATA_DIR / "README.md"
CPI_CSV = DATA_DIR / "cpi.csv"
CONFLICTS_LOG = DATA_DIR / "conflicts.log"
TMDB_CACHE = DATA_DIR / "tmdb_cache"
STAGING_JSON = DATA_DIR / "staging" / "movies.json"
ASSUMPTIONS_JSON = CONFIG_DIR / "assumptions.json"
DB_PATH = ROOT / "movies.db"
ENV_FILE = ROOT / ".env"

MONEY_FIELDS = (
    "production_budget",
    "opening_weekend_domestic",
    "domestic_gross",
    "international_gross",
    "worldwide_gross",
    "china_gross",
)

# Seed CSV people columns -> role stored in the people table.
PEOPLE_COLUMNS = {
    "director": "director",
    "producers": "producer",
    "executive_producers": "executive_producer",
    "lead_cast": "lead_cast",
}
ROLES = ("director", "producer", "executive_producer", "lead_cast")

# Column-name aliases accepted in data/boxoffice.csv (normalized: lowercase, underscores).
COLUMN_ALIASES = {
    "year": "release_year",
    "budget": "production_budget",
    "opening_weekend": "opening_weekend_domestic",
    "domestic": "domestic_gross",
    "international": "international_gross",
    "foreign_gross": "international_gross",
    "worldwide": "worldwide_gross",
    "china": "china_gross",
    "rating": "mpaa_rating",
    "mpaa": "mpaa_rating",
    "runtime": "runtime_min",
    "primary_genre": "genre",
    "directors": "director",
    "producer": "producers",
    "executive_producer": "executive_producers",
    "cast": "lead_cast",
    "collection": "franchise",
}


def normalize_header(name: str) -> str:
    key = re.sub(r"[^a-z0-9]+", "_", (name or "").strip().lower()).strip("_")
    return COLUMN_ALIASES.get(key, key)


def clean_text(value) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


BLANK_TOKENS = ("", "n/a", "na", "none", "null", "-", "?", "unknown")
_MONEY_SUFFIX = {"k": 1e3, "m": 1e6, "mm": 1e6, "b": 1e9, "bn": 1e9}


def parse_money(value) -> int | None:
    """Parse '$1,234,567', '237000000', '237M', '2.92B' into integer dollars.

    Blank, 'n/a', unparseable and negative values return None (missing), never 0.
    """
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return int(round(value)) if value >= 0 else None
    text = str(value).strip().lower().replace(",", "").replace("$", "").replace(" ", "")
    if text in BLANK_TOKENS:
        return None
    match = re.fullmatch(r"(-?\d+(?:\.\d+)?)(k|m|mm|b|bn)?", text)
    if not match:
        return None
    number = float(match.group(1)) * _MONEY_SUFFIX.get(match.group(2) or "", 1)
    if number < 0:
        return None
    return int(round(number))


def parse_int(value) -> int | None:
    if value is None:
        return None
    text = str(value).strip()
    match = re.search(r"-?\d+", text.replace(",", ""))
    return int(match.group(0)) if match else None


def split_names(value) -> list[str]:
    """Split 'A; B; C' (semicolon separated, order preserved, de-duplicated)."""
    text = clean_text(value)
    if not text:
        return []
    seen, names = set(), []
    for part in text.split(";"):
        name = " ".join(part.split())
        if name and name.lower() not in seen:
            seen.add(name.lower())
            names.append(name)
    return names


def fold(text: str) -> str:
    """Accent- and case-insensitive key used for matching names and titles."""
    decomposed = unicodedata.normalize("NFKD", text or "")
    return "".join(c for c in decomposed if not unicodedata.combining(c)).lower().strip()


def read_csv_rows(path: Path) -> list[dict]:
    with open(path, newline="", encoding="utf-8-sig") as handle:
        reader = csv.DictReader(handle)
        rows = []
        for raw in reader:
            rows.append({normalize_header(k): v for k, v in raw.items() if k is not None})
        return rows


def load_json(path: Path):
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


def write_json(path: Path, payload, indent=2) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=indent, ensure_ascii=False)
        handle.write("\n")


def read_env(path: Path = ENV_FILE) -> dict[str, str]:
    """Minimal .env reader (KEY=value lines, # comments). Real env vars win."""
    values: dict[str, str] = {}
    if path.exists():
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, val = line.partition("=")
            values[key.strip()] = val.strip().strip('"').strip("'")
    for key in list(values):
        if os.environ.get(key):
            values[key] = os.environ[key]
    if "TMDB_API_KEY" not in values and os.environ.get("TMDB_API_KEY"):
        values["TMDB_API_KEY"] = os.environ["TMDB_API_KEY"]
    return values
