"""Filesystem locations used across the tool."""

from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
RAW_DIR = DATA_DIR / "raw"
SAMPLE_DIR = DATA_DIR / "sample"
REPORTS_DIR = ROOT / "reports"

# Designation datasets (rebuilt by build_data.py).
DB_PATH = DATA_DIR / "designations.sqlite"
# HTTP cache: geocoder answers, HUBZone lookups, fetched web pages.
# Kept separate so rebuilding the designation data never throws away cached lookups.
CACHE_PATH = DATA_DIR / "cache.sqlite"

MANIFEST_PATH = DATA_DIR / "sources.json"
STATE_INCENTIVES_CSV = DATA_DIR / "state_incentives.csv"
