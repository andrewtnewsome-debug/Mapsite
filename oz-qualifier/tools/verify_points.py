#!/usr/bin/env python3
"""Check the tool's QOZ answer for an address against sources it does not use itself.

    python tools/verify_points.py "9500 Euclid Ave, Cleveland, OH 44195" "17000 Lorain Ave, Cleveland, OH 44111"

For each address (using the coordinates the tool geocoded):
  2018 round: point-in-polygon query on HUD's published Opportunity Zones layer (the data
              behind HUD's OZ maps). This uses no tract list and no geocoder tract assignment.
  2010 tract: Census TIGERweb Census2010 tract polygon at the point, compared with the
              geocoder's 2010 tract.
  2027 round: Census TIGERweb Census2020 tract polygon at the point, looked up in Treasury
              OTP's own 2027 designation file (a separate publication from the CDFI Fund file
              the tool loads).
"""

from __future__ import annotations

import datetime as dt
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import requests  # noqa: E402

from ozq import db  # noqa: E402
from ozq.geocode import geocode_address  # noqa: E402
from ozq.loaders import iter_records, read_rows  # noqa: E402
from ozq.manifest import load_manifest, required_geocoder_vintages  # noqa: E402
from ozq.net import USER_AGENT, Fetcher, download_file  # noqa: E402
from ozq.paths import RAW_DIR  # noqa: E402
from ozq.verdict import evaluate_tract_datasets, qoz_verdict  # noqa: E402

HUD = "https://services.arcgis.com/VTyQ9soqVukalItT/arcgis/rest/services/Opportunity_Zones/FeatureServer/13/query"
TIGER = "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/{svc}/MapServer/{layer}/query"
TREASURY_2027 = "https://home.treasury.gov/system/files/131/OZ2-Designations-2027-Data-Transparency-10302026.xlsx"


def point_query(url, lon, lat, fields):
    r = requests.get(url, params={
        "geometry": f"{lon},{lat}", "geometryType": "esriGeometryPoint", "inSR": "4326",
        "spatialRel": "esriSpatialRelIntersects", "outFields": fields, "returnGeometry": "false", "f": "json",
    }, headers={"User-Agent": USER_AGENT}, timeout=60)
    r.raise_for_status()
    return [f["attributes"] for f in r.json().get("features", [])]


def treasury_2027() -> set:
    dest = RAW_DIR / "crosscheck" / Path(TREASURY_2027).name
    if not dest.exists():
        download_file(TREASURY_2027, dest)
    spec = {"id": "t", "name": "t", "membership": "listed", "columns": {"geoid": "Census Tract Number"},
            "extra_columns": {}, "flags": {}}
    return {r["geoid"] for r in iter_records(spec, read_rows(dest, "xlsx", 0))}


def main(addresses) -> int:
    fetcher, conn = Fetcher(), db.connect()
    vintages = required_geocoder_vintages(load_manifest())
    t27 = treasury_2027()
    all_ok = True
    for addr in addresses:
        geo = geocode_address(fetcher, addr, vintages)
        print(f"\n=== {addr}")
        if not geo.ok:
            print(f"    geocoder: {geo.error}")
            all_ok = False
            continue
        res = evaluate_tract_datasets(conn, geo, dt.date.today())
        v = qoz_verdict(res)
        by_id = {r.dataset_id: r for r in res}
        print(f"    matched: {geo.matched_address}  ({geo.lat:.6f}, {geo.lon:.6f})")
        print(f"    TOOL: {v.answer} - {v.summary}")

        hud = point_query(HUD, geo.lon, geo.lat, "GEOID10,Rural")
        t10 = point_query(TIGER.format(svc="tigerWMS_Census2010", layer=14), geo.lon, geo.lat, "GEOID,NAME")
        t20 = point_query(TIGER.format(svc="tigerWMS_Census2020", layer=6), geo.lon, geo.lat, "GEOID,NAME")
        g10 = t10[0]["GEOID"] if t10 else None
        g20 = t20[0]["GEOID"] if t20 else None

        r18, r27 = by_id.get("qoz_2018"), by_id.get("qoz_2027")
        hud_yes = bool(hud)
        ok18 = r18 is not None and bool(r18.qualifies) == hud_yes
        print(f"    2018 round  tool: {'YES' if r18 and r18.qualifies else 'NO'} (tract {r18.geoid_used if r18 else '?'})"
              f"  | HUD polygon layer: {'YES ' + hud[0]['GEOID10'] if hud_yes else 'NO (point is in no 2018 OZ polygon)'}"
              f"  -> {'AGREE' if ok18 else 'DISAGREE'}")
        ok10 = r18 is not None and g10 == r18.geoid_used
        print(f"    2010 tract  geocoder: {r18.geoid_used if r18 else '?'}  | TIGERweb 2010 polygon: {g10}"
              f"  -> {'AGREE' if ok10 else 'DISAGREE'}")
        in27 = g20 in t27 if g20 else None
        ok27 = r27 is not None and bool(r27.qualifies) == bool(in27)
        print(f"    2027 round  tool: {'YES' if r27 and r27.qualifies else 'NO'} (tract {r27.geoid_used if r27 else '?'})"
              f"  | TIGERweb 2020 tract {g20} in Treasury OTP list: {'YES' if in27 else 'NO'}"
              f"  -> {'AGREE' if ok27 else 'DISAGREE'}")
        all_ok &= ok18 and ok10 and ok27
    print(f"\nOverall: {'all checks agree' if all_ok else 'DISAGREEMENT - investigate'}")
    return 0 if all_ok else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
