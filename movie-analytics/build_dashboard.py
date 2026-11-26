"""Step 3 of 3: export movies.db to JSON and generate the static dashboard.

    python build_dashboard.py

Writes:
  dashboard/data/movies.json   JSON export of the database + CPI table + assumptions
  dashboard/index.html         self-contained page (data, model, charts inlined): open it
                               straight from disk, no server and no network needed

Edit config/assumptions.json and rerun this script to change the default
assumptions; no re-ingest is needed. The page's Assumptions tab can also change
them live in the browser.
"""

from __future__ import annotations

import datetime as dt
import json
import sqlite3
import statistics
import sys

import profit_model as pm
from common import ASSUMPTIONS_JSON, DASHBOARD_DIR, DASHBOARD_SRC, DB_PATH, ROLES, write_json

EXPORT_JSON = DASHBOARD_DIR / "data" / "movies.json"
INDEX_HTML = DASHBOARD_DIR / "index.html"
MONEY_KEYS = ("production_budget", "opening_weekend_domestic", "domestic_gross",
              "international_gross", "worldwide_gross", "china_gross")


def export(conn: sqlite3.Connection) -> dict:
    conn.row_factory = sqlite3.Row
    meta = {row["key"]: row["value"] for row in conn.execute("SELECT key, value FROM meta")}
    genres: dict[int, list[str]] = {}
    for row in conn.execute("SELECT movie_id, genre FROM genres ORDER BY movie_id, rowid"):
        genres.setdefault(row["movie_id"], []).append(row["genre"])
    people: dict[int, dict[str, list[str]]] = {}
    for row in conn.execute("SELECT movie_id, person_name, role FROM people ORDER BY movie_id, role, billing_order"):
        people.setdefault(row["movie_id"], {}).setdefault(row["role"], []).append(row["person_name"])

    movies = []
    query = ("SELECT m.*, " + ", ".join(f"f.{k}" for k in MONEY_KEYS) + ", f.source "
             "FROM movies m JOIN financials f ON f.movie_id = m.id ORDER BY m.release_year, m.title")
    for row in conn.execute(query):
        movies.append({
            "id": row["id"],
            "title": row["title"],
            "year": row["release_year"],
            "date": row["release_date"],
            "studio": row["studio"],
            "distributor": row["distributor"],
            "genre": row["primary_genre"],
            "genres": genres.get(row["id"], []),
            "rating": row["mpaa_rating"],
            "runtime": row["runtime_min"],
            "franchise": row["franchise"],
            "tmdb_id": row["tmdb_id"],
            "fin": {**{k: row[k] for k in MONEY_KEYS}, "source": row["source"]},
            "people": {role: people.get(row["id"], {}).get(role, []) for role in ROLES},
        })
    dataset = {
        "source": meta.get("source"),
        "file": meta.get("file"),
        "film_count": len(movies),
        "tmdb_enriched": meta.get("tmdb_enriched") == "True",
        "ingested_at": meta.get("ingested_at"),
    }
    return {"dataset": dataset, "movies": movies}


def summarize(payload: dict, assumptions: dict, inflation: pm.Inflation) -> None:
    rows = []
    for movie in payload["movies"]:
        metrics = pm.compute(movie["fin"], movie["year"], assumptions, inflation)
        rows.append((movie, metrics))
    multiples = [m["gross_multiple"] for _, m in rows if m["gross_multiple"] is not None]
    rois = [m["est_roi"] for _, m in rows if m["est_roi"] is not None]
    scored = [m for _, m in rows if m["profitable"] is not None]
    print(f"  {len(rows)} films; median gross multiple {statistics.median(multiples):.2f}x; "
          f"median est. ROI {statistics.median(rois):+.1%}; "
          f"est. profitable {sum(m['profitable'] for m in scored)}/{len(scored)}")
    print(f"  assumptions: {pm.describe(assumptions, inflation)}")


def build_html(payload: dict) -> str:
    template = (DASHBOARD_SRC / "index.html").read_text(encoding="utf-8")
    data_json = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    data_json = data_json.replace("</", "<\\/")  # never close the <script> tag early
    pieces = {
        "/*__STYLE__*/": (DASHBOARD_SRC / "style.css").read_text(encoding="utf-8"),
        "/*__MODEL_JS__*/": (DASHBOARD_SRC / "model.js").read_text(encoding="utf-8"),
        "/*__APP_JS__*/": (DASHBOARD_SRC / "app.js").read_text(encoding="utf-8"),
        "/*__DATA__*/": data_json,
    }
    for marker, content in pieces.items():
        if template.count(marker) != 1:
            raise SystemExit(f"template marker {marker} missing or repeated in dashboard_src/index.html")
        template = template.replace(marker, content)
    return template


def main() -> int:
    if not DB_PATH.exists():
        print("build_dashboard: movies.db not found. Run `python ingest.py` and `python build_db.py` first.")
        return 1
    try:
        assumptions = pm.load_assumptions(ASSUMPTIONS_JSON)
    except ValueError as exc:
        print(f"build_dashboard: config/assumptions.json is invalid: {exc}")
        return 1
    cpi = pm.load_cpi()
    inflation = pm.Inflation(cpi)

    conn = sqlite3.connect(DB_PATH)
    payload = export(conn)
    conn.close()
    payload = {
        "generated_at": dt.datetime.now().isoformat(timespec="seconds"),
        **payload,
        "assumptions": assumptions,
        "cpi": {str(year): value for year, value in sorted(cpi.items())},
        "cpi_latest_year": inflation.latest_year,
        "disclaimer": pm.DISCLAIMER,
    }
    print(f"build_dashboard: exporting {len(payload['movies'])} films")
    summarize(payload, assumptions, inflation)
    write_json(EXPORT_JSON, payload)
    INDEX_HTML.write_text(build_html(payload), encoding="utf-8")
    size_kb = INDEX_HTML.stat().st_size / 1024
    print(f"  wrote {EXPORT_JSON.relative_to(DASHBOARD_DIR.parent)} and "
          f"{INDEX_HTML.relative_to(DASHBOARD_DIR.parent)} ({size_kb:,.0f} KB)")
    print(f"  open {INDEX_HTML} in a browser")
    return 0


if __name__ == "__main__":
    sys.exit(main())
