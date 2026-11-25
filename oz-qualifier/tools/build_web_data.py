#!/usr/bin/env python3
"""Build the static data behind the browser lookup page (web/).

    python tools/build_web_data.py

Reads data/designations.sqlite (run build_data.py first) and the Census Bureau's
ZIP Code Tabulation Area (ZCTA) to census tract relationship files, and writes:

  web/data/zips/<N>.json       ZIP -> tracts with land-area share and designation flags,
                               split by the first digit of the ZIP
  web/data/designations.json   tract lists for exact tract-number lookups
  web/data/counties.json       county FIPS -> "County, State"
  web/data/states.json         state FIPS -> [abbr, name] and the state incentive rows

ZCTAs approximate ZIP delivery areas. PO-box-only and single-building ZIPs have no ZCTA.
2010 ZCTA/tract pairs feed the 2018 round (2010 tracts); 2020 pairs feed the 2027 round
and NMTC (2020 tracts). The 2027 list uses Connecticut's planning-region county codes,
so Connecticut tracts are matched to it on the six-digit tract code (unique in the
state apart from two water-only tracts, neither designated).
"""

from __future__ import annotations

import csv
import json
import sqlite3
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from ozq.net import download_file  # noqa: E402
from ozq.paths import DB_PATH, RAW_DIR, STATE_INCENTIVES_CSV  # noqa: E402

REL_2020 = "https://www2.census.gov/geo/docs/maps-data/data/rel2020/zcta520/tab20_zcta520_tract20_natl.txt"
REL_2010 = "https://www2.census.gov/geo/docs/maps-data/data/rel/zcta_tract_rel_10.txt"
OUT = ROOT / "web" / "data"

STATES = {
    "01": ("AL", "Alabama"), "02": ("AK", "Alaska"), "04": ("AZ", "Arizona"), "05": ("AR", "Arkansas"),
    "06": ("CA", "California"), "08": ("CO", "Colorado"), "09": ("CT", "Connecticut"), "10": ("DE", "Delaware"),
    "11": ("DC", "District of Columbia"), "12": ("FL", "Florida"), "13": ("GA", "Georgia"), "15": ("HI", "Hawaii"),
    "16": ("ID", "Idaho"), "17": ("IL", "Illinois"), "18": ("IN", "Indiana"), "19": ("IA", "Iowa"),
    "20": ("KS", "Kansas"), "21": ("KY", "Kentucky"), "22": ("LA", "Louisiana"), "23": ("ME", "Maine"),
    "24": ("MD", "Maryland"), "25": ("MA", "Massachusetts"), "26": ("MI", "Michigan"), "27": ("MN", "Minnesota"),
    "28": ("MS", "Mississippi"), "29": ("MO", "Missouri"), "30": ("MT", "Montana"), "31": ("NE", "Nebraska"),
    "32": ("NV", "Nevada"), "33": ("NH", "New Hampshire"), "34": ("NJ", "New Jersey"), "35": ("NM", "New Mexico"),
    "36": ("NY", "New York"), "37": ("NC", "North Carolina"), "38": ("ND", "North Dakota"), "39": ("OH", "Ohio"),
    "40": ("OK", "Oklahoma"), "41": ("OR", "Oregon"), "42": ("PA", "Pennsylvania"), "44": ("RI", "Rhode Island"),
    "45": ("SC", "South Carolina"), "46": ("SD", "South Dakota"), "47": ("TN", "Tennessee"), "48": ("TX", "Texas"),
    "49": ("UT", "Utah"), "50": ("VT", "Vermont"), "51": ("VA", "Virginia"), "53": ("WA", "Washington"),
    "54": ("WV", "West Virginia"), "55": ("WI", "Wisconsin"), "56": ("WY", "Wyoming"), "60": ("AS", "American Samoa"),
    "66": ("GU", "Guam"), "69": ("MP", "Northern Mariana Islands"), "72": ("PR", "Puerto Rico"),
    "78": ("VI", "U.S. Virgin Islands"),
}


def fetch(url: str) -> Path:
    dest = RAW_DIR / "web" / Path(url).name
    if not dest.exists():
        print(f"downloading {url}")
        download_file(url, dest)
    return dest


def main() -> int:
    if not DB_PATH.exists():
        print("Run python build_data.py first.")
        return 1
    db = sqlite3.connect(str(DB_PATH))
    q18 = {g: json.loads(f or "{}").get("rural", False) for g, f in db.execute("SELECT geoid, flags FROM tracts_qoz_2018")}
    q27 = {g: json.loads(f or "{}").get("rural", False) for g, f in db.execute("SELECT geoid, flags FROM tracts_qoz_2027")}
    nmtc_all = {g: q for g, q in db.execute("SELECT geoid, qualifies FROM tracts_nmtc_2016_2020")}
    nmtc = {g for g, q in nmtc_all.items() if q}
    q27_ct = {g[5:]: g for g in q27 if g.startswith("09")}
    for row in db.execute("SELECT dataset_id, vintage_date, row_count, is_sample FROM datasets WHERE program IN ('QOZ','NMTC')"):
        if row[3]:
            print(f"WARNING: {row[0]} is SAMPLE data; run build_data.py before building web data")

    def q27_status(g20: str):
        if g20 in q27:
            return True, q27[g20]
        if g20.startswith("09") and g20[5:] in q27_ct:
            return True, q27[q27_ct[g20[5:]]]
        return False, False

    zips = defaultdict(lambda: [[], []])
    zip_land20 = {}
    with open(fetch(REL_2020), encoding="utf-8-sig") as fh:
        rdr = csv.reader(fh, delimiter="|")
        head = next(rdr)
        i = {k: n for n, k in enumerate(head)}
        for r in rdr:
            z = r[i["GEOID_ZCTA5_20"]]
            if not z:
                continue
            g = r[i["GEOID_TRACT_20"]]
            zl = float(r[i["AREALAND_ZCTA5_20"]] or 0)
            part = float(r[i["AREALAND_PART"]] or 0)
            pct = round(100.0 * part / zl, 2) if zl else 0.0
            in27, rural27 = q27_status(g)
            flags = (1 if in27 else 0) | (2 if g in nmtc else 0) | (4 if rural27 else 0)
            if pct > 0 or flags:
                zips[z][1].append([g, pct, flags])
            zip_land20[z] = zl
    with open(fetch(REL_2010), encoding="utf-8-sig") as fh:
        rdr = csv.reader(fh)
        head = [h.strip() for h in next(rdr)]
        i = {k: n for n, k in enumerate(head)}
        for r in rdr:
            z, g = r[i["ZCTA5"]], r[i["GEOID"]]
            pct = float(r[i["ZAREALANDPCT"]] or 0)
            alias = "51019" + g[5:] if g.startswith("51515") else g  # Bedford city, VA (see sources.json)
            flags = (1 if alias in q18 else 0) | (2 if q18.get(alias) else 0)
            if pct > 0 or flags:
                zips[z][0].append([alias if flags else g, round(pct, 2), flags])

    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "zips").mkdir(exist_ok=True)
    buckets = defaultdict(dict)
    for z, (t10, t20) in zips.items():
        t10.sort(key=lambda x: -x[1])
        t20.sort(key=lambda x: -x[1])
        buckets[z[:1]][z] = [t10, t20]
    for b, data in buckets.items():
        (OUT / "zips" / f"{b}.json").write_text(json.dumps(data, separators=(",", ":")), encoding="utf-8")

    (OUT / "designations.json").write_text(json.dumps({
        "q18": sorted(q18), "q18rural": sorted(g for g, r in q18.items() if r),
        "q27": sorted(q27), "q27rural": sorted(g for g, r in q27.items() if r),
        "nmtc": sorted(nmtc),
    }, separators=(",", ":")), encoding="utf-8")

    counties = {}
    for table in ("tracts_nmtc_2016_2020", "tracts_qoz_2027", "tracts_qoz_2018"):
        for g, s, c in db.execute(f"SELECT geoid, state_name, county_name FROM {table}"):
            fips = g[:5]
            if fips in counties or not c:
                continue
            c = c.strip()
            if table == "tracts_qoz_2018" and not c.lower().endswith(("county", "parish", "borough", "area", "city", "municipio", "census area", "municipality", "district", "island", "islands")):
                c += " County" if g[:2] not in ("22", "72", "02") else ""
            counties[fips] = f"{c}, {(s or STATES.get(g[:2], ('', ''))[1]).strip()}"
    (OUT / "counties.json").write_text(json.dumps(counties, separators=(",", ":"), sort_keys=True), encoding="utf-8")

    with open(STATE_INCENTIVES_CSV, newline="", encoding="utf-8") as fh:
        programs = list(csv.DictReader(fh))
    (OUT / "states.json").write_text(json.dumps({"states": STATES, "programs": programs}, separators=(",", ":")),
                                     encoding="utf-8")

    sizes = sum(p.stat().st_size for p in OUT.rglob("*.json"))
    print(f"{len(zips):,} ZIPs in {len(buckets)} files; {len(q18):,} / {len(q27):,} / {len(nmtc):,} tracts; "
          f"{len(counties):,} counties; {sizes / 1e6:.1f} MB total in {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
