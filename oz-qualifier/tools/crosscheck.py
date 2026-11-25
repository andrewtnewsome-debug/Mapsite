#!/usr/bin/env python3
"""Cross-check the loaded designation tables against independent official publications.

    python tools/crosscheck.py            # full-set comparisons + spot checks
    python tools/crosscheck.py --spot 39035107101 39035118900

Checks (run after every refresh):
  qoz_2018  vs HUD's published Opportunity Zones feature service (GEOID10 of every polygon)
  qoz_2027  vs Treasury Office of Tax Policy's 2027 QOZ designations file (data transparency page)
  nmtc      internal consistency: LIC flag vs poverty >= 20% or MFI ratio <= 0.80 (or 0.85 high-migration)
  spot      named tracts looked up in the tables and in HUD's service by GEOID
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import requests  # noqa: E402

from ozq import db  # noqa: E402
from ozq.loaders import iter_records, read_rows  # noqa: E402
from ozq.net import USER_AGENT, download_file  # noqa: E402
from ozq.paths import RAW_DIR  # noqa: E402

HUD_OZ_LAYER = ("https://services.arcgis.com/VTyQ9soqVukalItT/arcgis/rest/services/"
                "Opportunity_Zones/FeatureServer/13/query")
TREASURY_2027 = ("https://home.treasury.gov/system/files/131/"
                 "OZ2-Designations-2027-Data-Transparency-10302026.xlsx")


def hud_all_geoids() -> set:
    out, offset = set(), 0
    while True:
        r = requests.get(HUD_OZ_LAYER, params={
            "where": "1=1", "outFields": "GEOID10", "returnGeometry": "false", "f": "json",
            "resultOffset": offset, "resultRecordCount": 2000, "orderByFields": "OBJECTID",
        }, headers={"User-Agent": USER_AGENT}, timeout=60)
        r.raise_for_status()
        data = r.json()
        feats = data.get("features", [])
        out.update(f["attributes"]["GEOID10"] for f in feats)
        if not feats or not data.get("exceededTransferLimit"):
            break
        offset += len(feats)
    return out


def hud_lookup(geoid: str):
    r = requests.get(HUD_OZ_LAYER, params={"where": f"GEOID10='{geoid}'", "outFields": "GEOID10,STATE_NAME,Rural",
                                           "returnGeometry": "false", "f": "json"},
                     headers={"User-Agent": USER_AGENT}, timeout=60)
    r.raise_for_status()
    feats = r.json().get("features", [])
    return feats[0]["attributes"] if feats else None


def table_geoids(conn, dataset_id: str) -> set:
    return {r[0] for r in conn.execute(f"SELECT geoid FROM {db.table_name(dataset_id)} WHERE qualifies=1")}


def compare(label: str, ours: set, theirs: set) -> bool:
    only_ours, only_theirs = sorted(ours - theirs), sorted(theirs - ours)
    ok = not only_ours and not only_theirs
    print(f"[{'PASS' if ok else 'DIFF'}] {label}: ours {len(ours):,} / theirs {len(theirs):,} / "
          f"in both {len(ours & theirs):,}")
    if only_ours:
        print(f"       only in our table ({len(only_ours)}): {only_ours[:10]}")
    if only_theirs:
        print(f"       only in theirs ({len(only_theirs)}): {only_theirs[:10]}")
    return ok


def check_nmtc(conn) -> bool:
    bad = []
    n = 0
    for r in conn.execute("SELECT geoid, qualifies, flags, extra FROM tracts_nmtc_2016_2020"):
        n += 1
        extra, flags = json.loads(r["extra"]), json.loads(r["flags"])
        pov, mfi = extra.get("poverty_rate_pct"), extra.get("mfi_ratio_to_benchmark")
        pov = pov if isinstance(pov, (int, float)) else None
        mfi = mfi if isinstance(mfi, (int, float)) else None
        if pov is None and mfi is None:
            continue
        expect = (pov is not None and pov >= 20) or (mfi is not None and mfi <= 0.80) or \
                 (flags.get("high_migration_rural") and mfi is not None and mfi <= 0.85)
        if bool(r["qualifies"]) != bool(expect):
            bad.append((r["geoid"], r["qualifies"], pov, mfi))
    ok = len(bad) <= n * 0.001  # rounding at the 20.0% / 80.0% edges is expected to be rare
    print(f"[{'PASS' if ok else 'DIFF'}] nmtc_2016_2020 internal consistency: {n:,} tracts, "
          f"{len(bad)} where the LIC flag disagrees with the poverty/MFI columns")
    for b in bad[:8]:
        print(f"       {b}")
    return ok


def spot(conn, geoids) -> None:
    print("\nSpot checks (our tables vs HUD feature service by GEOID):")
    for g in geoids:
        row18 = db.lookup_tract(conn, "qoz_2018", g)
        row27 = db.lookup_tract(conn, "qoz_2027", g)
        nmtc = db.lookup_tract(conn, "nmtc_2016_2020", g)
        hud = hud_lookup(g)
        print(f"  {g}: qoz_2018={'YES' if row18 else 'no'}"
              f"{' (' + row18['category'] + ', rural=' + str(row18['flags'].get('rural')) + ')' if row18 else ''}"
              f" | HUD 2018 layer={'YES' if hud else 'no'}{' ' + json.dumps(hud) if hud else ''}"
              f" | qoz_2027={'YES' if row27 else 'no'}{' (' + row27['category'] + ')' if row27 else ''}"
              f" | nmtc={'n/a' if not nmtc else ('LIC' if nmtc['qualifies'] else 'not LIC')}")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--spot", nargs="*", default=[], help="extra GEOIDs to spot check")
    args = ap.parse_args(argv)
    conn = db.connect()
    ok = True

    print("Fetching HUD Opportunity Zones feature service (2018 zones, GEOID10)...")
    hud = hud_all_geoids()
    ds18 = conn.execute("SELECT * FROM datasets WHERE dataset_id='qoz_2018'").fetchone()
    aliases = json.loads(ds18["lookup_aliases"] or "{}")
    # HUD also carries a few tracts under their 2010 county codes; fold those through the manifest aliases.
    folded = {aliases.get(g[:5], g[:5]) + g[5:] for g in hud}
    if folded != hud:
        print(f"       (HUD codes folded through lookup_county_aliases {aliases}: "
              f"{sorted(g for g in hud if g[:5] in aliases)})")
    ok &= compare("qoz_2018 vs HUD feature service", table_geoids(conn, "qoz_2018"), folded)

    dest = RAW_DIR / "crosscheck" / Path(TREASURY_2027).name
    if not dest.exists():
        download_file(TREASURY_2027, dest)
    tre = {"id": "treasury", "name": "treasury", "membership": "listed",
           "columns": {"geoid": "Census Tract Number"}, "extra_columns": {}, "flags": {}}
    theirs = {r["geoid"] for r in iter_records(tre, read_rows(dest, "xlsx", 0))}
    ok &= compare("qoz_2027 vs Treasury OTP data transparency file", table_geoids(conn, "qoz_2027"), theirs)

    ok &= check_nmtc(conn)
    if args.spot:
        spot(conn, args.spot)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
