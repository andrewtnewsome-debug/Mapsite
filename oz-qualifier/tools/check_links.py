#!/usr/bin/env python3
"""Check that every official link the tool prints still resolves.

    python tools/check_links.py            # state_incentives.csv + dataset source URLs

Run it when you refresh the state table. A failing link means the program page moved
or the program ended: open the agency site, fix official_url, re-check the description,
and bump as_of in data/state_incentives.csv.
"""

from __future__ import annotations

import csv
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import requests  # noqa: E402

from ozq.net import USER_AGENT  # noqa: E402
from ozq.paths import MANIFEST_PATH, STATE_INCENTIVES_CSV  # noqa: E402


def check(url: str):
    try:
        r = requests.get(url, headers={"User-Agent": USER_AGENT}, timeout=30, allow_redirects=True, stream=True)
        r.close()
        return r.status_code, r.url
    except requests.RequestException as exc:
        return None, f"{exc.__class__.__name__}"


def main() -> int:
    targets = []
    with open(STATE_INCENTIVES_CSV, newline="", encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            targets.append((f"{row['state']} {row['program_name']}", row["official_url"]))
    for ds in json.load(open(MANIFEST_PATH, encoding="utf-8"))["datasets"]:
        for key in ("source_url", "source_page"):
            if ds.get(key):
                targets.append((f"dataset {ds['id']} {key}", ds[key]))
    bad = 0
    for label, url in targets:
        status, final = check(url)
        ok = status is not None and status < 400
        bad += not ok
        moved = f" -> {final}" if ok and final.rstrip("/") != url.rstrip("/") else ""
        print(f"[{'OK ' if ok else 'BAD'}] {status or final:>4}  {label}\n         {url}{moved}")
    print(f"\n{len(targets) - bad}/{len(targets)} links OK")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
