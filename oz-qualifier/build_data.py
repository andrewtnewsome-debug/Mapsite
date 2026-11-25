#!/usr/bin/env python3
"""Download and load the designation datasets into data/designations.sqlite.

    python build_data.py                 # use files already in data/raw/, download any missing
    python build_data.py --refresh       # re-download every source file
    python build_data.py --only qoz_2027 # load one dataset
    python build_data.py --offline       # never touch the network; fall back to samples
    python build_data.py --status        # show what is loaded

Every dataset is described in data/sources.json. If an official file cannot be
downloaded and is not already in data/raw/, the loader prints exactly which file
to drop in and loads the small test sample from data/sample/ instead (flagged as
SAMPLE in every report).
"""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import json
import sys
from pathlib import Path

from ozq import db
from ozq.loaders import iter_records, read_rows, supplement_geoids, to_db_rows
from ozq.manifest import load_manifest, tract_datasets
from ozq.net import download_file, sha256_file
from ozq.paths import DB_PATH, RAW_DIR, SAMPLE_DIR, STATE_INCENTIVES_CSV


def log(msg: str) -> None:
    print(msg, flush=True)


def ensure_file(url, local_name: str, refresh: bool, offline: bool) -> tuple:
    """Return (path or None, how) where how is 'cached', 'downloaded' or an error message."""
    path = RAW_DIR / local_name
    if path.exists() and not refresh:
        return path, "cached"
    if offline or not url:
        return (path, "cached") if path.exists() else (None, "offline" if offline else "no source_url")
    try:
        download_file(url, path)
        return path, "downloaded"
    except Exception as exc:  # network errors, HTTP errors
        if path.exists():
            return path, f"download failed ({exc}); using existing copy"
        return None, f"download failed: {exc}"


def drop_in_instructions(ds: dict, reason: str) -> str:
    return (
        f"  !! {ds['id']}: official file unavailable ({reason}).\n"
        f"     To load the real list, download:\n"
        f"         {ds.get('source_url') or '(see source_page)'}\n"
        f"     from {ds.get('source_page', 'the publishing agency')}\n"
        f"     and save it as:\n"
        f"         {RAW_DIR / ds['local_file']}\n"
        f"     then run: python build_data.py --only {ds['id']}\n"
    )


def load_dataset(conn, ds: dict, refresh: bool, offline: bool) -> dict:
    vintage_date = ds.get("vintage_date")
    path, how = ensure_file(ds.get("source_url"), ds["local_file"], refresh, offline)
    is_sample = False
    if path is None:
        sample = SAMPLE_DIR / f"{ds['id']}.csv"
        log(drop_in_instructions(ds, how))
        if not sample.exists():
            log(f"     No sample at {sample}; {ds['id']} not loaded.")
            return {"id": ds["id"], "loaded": False}
        log(f"     Loading SAMPLE tracts from {sample} for testing only.")
        sample_ds = dict(ds, format="csv", sheet=0, membership="flag",
                         columns={"geoid": "geoid", "qualifies": "qualifies", "category": "category",
                                  "state": "state", "county": "county"},
                         qualifies_true_values=["1", "YES", "TRUE"], extra_columns={}, flags={})
        rows = read_rows(sample, "csv")
        records = list(iter_records(sample_ds, rows))
        path, is_sample = sample, True
    else:
        log(f"  {ds['id']}: {path.name} ({how})")
        rows = read_rows(path, ds["format"], ds.get("sheet", 0))
        records = list(iter_records(ds, rows))

    # De-duplicate on GEOID (keep the first row) and report it.
    by_geoid = {}
    dups = 0
    for r in records:
        if r["geoid"] in by_geoid:
            dups += 1
            continue
        by_geoid[r["geoid"]] = r

    # Supplements: extra official lists that set a flag (and optionally qualification).
    sup_notes = []
    for sup in ([] if is_sample else ds.get("supplements", [])):
        spath, show = ensure_file(sup.get("source_url"), sup["local_file"], refresh, offline)
        if spath is None:
            sup_notes.append(f"{sup['id']} not loaded ({show})")
            log(f"     supplement {sup['id']}: NOT loaded ({show})")
            continue
        geoids = supplement_geoids(sup, read_rows(spath, sup["format"], sup.get("sheet", 0)))
        matched = added = 0
        aliases = sup.get("geoid_county_aliases", {})
        for g in geoids:
            if g not in by_geoid and g[:5] in aliases:
                g = aliases[g[:5]] + g[5:]
            rec = by_geoid.get(g)
            if rec is None:
                if not sup.get("sets_qualifies"):
                    continue
                rec = by_geoid[g] = {"geoid": g, "qualifies": True, "category": None, "state": None,
                                     "county": None, "flags": {}, "extra": {}}
                added += 1
            else:
                matched += 1
            rec["flags"][sup["sets_flag"]] = True
            if sup.get("sets_qualifies"):
                if not rec["qualifies"]:
                    rec["category"] = sup["description"]
                rec["qualifies"] = True
        note = f"{sup['id']}: {len(geoids)} tracts in file, {matched} matched, {added} added"
        if sup.get("expected_count") and len(geoids) != sup["expected_count"]:
            note += f" (EXPECTED {sup['expected_count']})"
        sup_notes.append(note)
        log(f"     supplement {note}")
        for rec in by_geoid.values():
            rec["flags"].setdefault(sup["sets_flag"], False)

    n = db.replace_tract_table(conn, ds["id"], to_db_rows(ds, by_geoid.values(), vintage_date))
    qualifying = sum(1 for r in by_geoid.values() if r["qualifies"])
    notes = []
    if dups:
        notes.append(f"{dups} duplicate GEOID rows ignored")
    if ds.get("expected_count") and not is_sample and n != ds["expected_count"]:
        notes.append(f"row count {n} differs from expected {ds['expected_count']}")
    notes.extend(sup_notes)

    with conn:
        conn.execute("DELETE FROM datasets WHERE dataset_id=?", (ds["id"],))
        conn.execute(
            "INSERT INTO datasets (dataset_id, program, name, round_label, authority, vintage_date,"
            " effective_date, expires_date, expires_by_state_fips, period_note, tract_vintage,"
            " geocoder_vintage, lookup_aliases, membership, source_url, source_page, source_file, source_sha256,"
            " row_count, qualifying_count, is_sample, map_url_template, map_label, loaded_at, notes)"
            " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                ds["id"], ds["program"], ds["name"], ds.get("round_label"), ds.get("authority"),
                vintage_date, ds.get("effective_date"), ds.get("expires_date"),
                json.dumps(ds.get("expires_by_state_fips") or {}), ds.get("period_note"),
                ds["tract_vintage"], ds["geocoder_vintage"], json.dumps(ds.get("lookup_county_aliases") or {}),
                ds["membership"], ds.get("source_url"),
                ds.get("source_page"), str(path.name), sha256_file(path), n, qualifying,
                1 if is_sample else 0, ds.get("map_url_template"), ds.get("map_label"),
                dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC"), "; ".join(notes) or None,
            ),
        )
    log(f"     loaded {n:,} tracts ({qualifying:,} qualifying){' [SAMPLE]' if is_sample else ''}")
    for note in notes:
        if "differs" in note or "EXPECTED" in note:
            log(f"     WARNING: {note}")
    return {"id": ds["id"], "loaded": True, "rows": n, "qualifying": qualifying, "sample": is_sample}


def register_live_sources(conn, manifest) -> None:
    """Datasets queried live (HUBZone map) still get a datasets row so reports can cite them."""
    for ds in manifest:
        if ds.get("method") == "tract_file":
            continue
        with conn:
            conn.execute("DELETE FROM datasets WHERE dataset_id=?", (ds["id"],))
            conn.execute(
                "INSERT INTO datasets (dataset_id, program, name, round_label, authority, vintage_date,"
                " effective_date, expires_date, period_note, membership, source_url, source_page,"
                " map_url_template, map_label, loaded_at, notes)"
                " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (
                    ds["id"], ds["program"], ds["name"], ds.get("round_label"), ds.get("authority"),
                    ds.get("vintage_date"), ds.get("effective_date"), ds.get("expires_date"),
                    ds.get("period_note"), ds.get("method"), ds.get("endpoint"), ds.get("source_page"),
                    ds.get("map_url_template"), ds.get("map_label"),
                    dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
                    json.dumps({"cache_days": ds.get("cache_days")}),
                ),
            )
        log(f"  {ds['id']}: live source registered ({ds.get('endpoint')})")


def load_state_incentives(conn, path: Path = STATE_INCENTIVES_CSV) -> int:
    if not path.exists():
        log(f"  state_incentives: {path} not found; table left empty")
        return 0
    with open(path, newline="", encoding="utf-8") as fh:
        rows = list(csv.DictReader(fh))
    required = ["state", "program_name", "program_type", "description", "official_url", "as_of"]
    for i, r in enumerate(rows, start=2):
        missing = [k for k in required if not (r.get(k) or "").strip()]
        if missing:
            raise SystemExit(f"{path}:{i}: missing {missing}")
    with conn:
        conn.execute("DELETE FROM state_incentives")
        conn.executemany(
            "INSERT INTO state_incentives (state, program_name, program_type, description, official_url,"
            " notes, as_of) VALUES (?,?,?,?,?,?,?)",
            [(r["state"].strip().upper(), r["program_name"].strip(), r["program_type"].strip(),
              r["description"].strip(), r["official_url"].strip(), (r.get("notes") or "").strip() or None,
              r["as_of"].strip()) for r in rows],
        )
    states = sorted({r["state"].strip().upper() for r in rows})
    log(f"  state_incentives: {len(rows)} rows for {', '.join(states)}")
    return len(rows)


def status(conn) -> None:
    rows = db.datasets(conn)
    if not rows:
        print("No datasets loaded. Run: python build_data.py")
        return
    print(f"{'dataset':18} {'program':8} {'tracts':>8} {'qualify':>8} {'tract':>5}  {'geocoder vintage':19} {'vintage':10}  loaded")
    for r in rows:
        print(f"{r['dataset_id']:18} {r['program']:8} {r['row_count'] or 0:>8,} {r['qualifying_count'] or 0:>8,}"
              f" {r['tract_vintage'] or '-':>5}  {r['geocoder_vintage'] or '(live)':19} {r['vintage_date'] or '-':10}"
              f"  {r['loaded_at']}{'  SAMPLE' if r['is_sample'] else ''}")
        if r["notes"] and r["membership"] != "sba_map_point_lookup":
            print(f"{'':18} note: {r['notes']}")
    n = conn.execute("SELECT COUNT(*) FROM state_incentives").fetchone()[0]
    print(f"state_incentives rows: {n}")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--refresh", action="store_true", help="re-download every source file")
    ap.add_argument("--offline", action="store_true", help="do not use the network")
    ap.add_argument("--only", nargs="+", metavar="ID", help="load only these dataset ids")
    ap.add_argument("--status", action="store_true", help="show loaded datasets and exit")
    args = ap.parse_args(argv)

    conn = db.connect(DB_PATH)
    if args.status:
        status(conn)
        return 0

    manifest = load_manifest()
    todo = tract_datasets(manifest)
    if args.only:
        unknown = set(args.only) - {d["id"] for d in manifest}
        if unknown:
            print(f"unknown dataset id(s): {', '.join(sorted(unknown))}", file=sys.stderr)
            return 2
        todo = [d for d in todo if d["id"] in args.only]

    log(f"Building {DB_PATH}")
    results = [load_dataset(conn, ds, args.refresh, args.offline) for ds in todo]
    if not args.only:
        register_live_sources(conn, manifest)
        load_state_incentives(conn)
    log("")
    status(conn)
    failed = [r["id"] for r in results if not r["loaded"]]
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
