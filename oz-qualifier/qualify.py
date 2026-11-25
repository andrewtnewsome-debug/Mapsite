#!/usr/bin/env python3
"""Screen a business location for Opportunity Zone and related incentive designations.

    python qualify.py --website https://example.com
    python qualify.py --address "9500 Euclid Ave, Cleveland, OH 44195"
    python qualify.py --name "Acme Co" --address "..."          # name is only a label
    python qualify.py --latlon 41.5033,-81.6229                 # skip address matching
    python qualify.py --serve                                   # local web form at http://127.0.0.1:8765

The resolved address is always shown, and in an interactive terminal you confirm or
correct it before the verdict is final. With --yes (or when not run from a terminal)
the report says the address was not confirmed. A one-page HTML report per location is
written to reports/. Run build_data.py first.

This is a screening tool, not tax, legal or investment advice.
"""

from __future__ import annotations

import argparse
import datetime as dt
import re
import sys
from pathlib import Path
from typing import List, Optional, Tuple
from urllib.parse import urlparse

from ozq import db
from ozq.extract import INCLUDE_THRESHOLD, Candidate, extract_from_website
from ozq.geocode import GeocodeResult, geocode_address, geocode_point
from ozq.hubzone import lookup as hubzone_lookup
from ozq.manifest import load_manifest, required_geocoder_vintages
from ozq.net import Fetcher
from ozq.paths import REPORTS_DIR
from ozq.report import AddressOrigin, LocationReport, render_console, write_html
from ozq.verdict import evaluate_tract_datasets, qoz_verdict

NAME_ONLY_MSG = """\
A company name alone is not enough to place a business in a census tract, and this
tool will not guess. Re-run with the company's website or its street address:

    python qualify.py --name "{name}" --website https://company.example
    python qualify.py --name "{name}" --address "123 Main St, City, ST 12345"

(--address is the most reliable path. Looking companies up by name via web search
is planned for a later version.)"""

REGION_LABEL = {"main": "page body", "structured": "schema.org data", "footer": "footer",
                "header": "header", "map_link": "map link", "script": "embedded page data"}
PROGRAM_ORDER = ["state_oz_conformity", "state_oz_credit", "state_oz_designation", "state_nmtc",
                 "job_creation_credit", "location_credit", "deal_closing_grant", "property_tax_limitation", "ssbci"]


def say(msg: str = "") -> None:
    print(msg, flush=True)


def ask(prompt: str) -> str:
    try:
        return input(prompt).strip()
    except EOFError:
        return ""


def describe(c: Candidate) -> str:
    b = c.best_source
    pages = len({s.url for s in c.sources})
    where = f"{REGION_LABEL.get(b.region, b.region)} of {b.page_type} page"
    return f"{where}, seen on {pages} page{'s' if pages != 1 else ''}, confidence {c.score:.2f}"


def _house_and_zip(s: str) -> Tuple[Optional[str], Optional[str]]:
    num = re.match(r"\s*(\d+)", s or "")
    z = re.findall(r"\b(\d{5})(?:-\d{4})?\b", s or "")
    return (num.group(1) if num else None, z[-1] if z else None)


def choose_from_website(args, fetcher, interactive) -> List[Tuple[str, AddressOrigin]]:
    say(f"Looking for addresses on {args.website} ...")
    ex = extract_from_website(fetcher, args.website)
    for url, ptype, status in ex.pages:
        say(f"  checked {ptype:9} {status:12} {url}")
    for n in ex.notes:
        say(f"  note: {n}")
    if not ex.candidates:
        if interactive:
            typed = ask("No address found. Type the street address (or press Enter to quit): ")
            if typed:
                return [(typed, AddressOrigin("user", "typed at the prompt after website search found nothing",
                                              confirmed=True, confirmation_note="typed by the user"))]
        return []

    strong = [c for c in ex.candidates if c.score >= INCLUDE_THRESHOLD][: args.max_locations]
    say("\nAddresses found:")
    for i, c in enumerate(ex.candidates, 1):
        marker = "*" if c in strong else " "
        say(f"  {marker}[{i}] {c.one_line}\n        {describe(c)}  {c.best_source.url}")
    picks: List[Candidate]
    note: str
    confirmed = False
    if interactive:
        default = ",".join(str(ex.candidates.index(c) + 1) for c in strong) or "1"
        while True:
            ans = ask(f"\nQualify which? Enter = [{default}], numbers like 1,3, 'e' to type a corrected address, 'q' to quit: ")
            if ans.lower() == "q":
                return []
            if ans.lower() == "e":
                typed = ask("Street address: ")
                return [(typed, AddressOrigin("user", "corrected by the user at the prompt", url=args.website,
                                              confirmed=True, confirmation_note="typed by the user"))] if typed else []
            try:
                idx = [int(x) for x in re.split(r"[,\s]+", ans or default) if x]
                picks = [ex.candidates[i - 1] for i in idx]
                break
            except (ValueError, IndexError):
                say("  Please enter numbers from the list, 'e' or 'q'.")
        confirmed, note = True, "selected by the user at the prompt"
    else:
        picks = strong or ex.candidates[:1]
        note = ("accepted automatically with --yes, not reviewed" if args.yes
                else "extracted automatically; run in a terminal to confirm, or pass --address")
        if not strong:
            note += "; LOW-CONFIDENCE address"
    out = []
    for c in picks:
        b = c.best_source
        out.append((c.one_line, AddressOrigin("website", f"{REGION_LABEL.get(b.region, b.region)} of {b.page_type} page",
                                              url=b.url, confirmed=confirmed, confirmation_note=note)))
    return out


def geocode_with_confirmation(fetcher, address: str, origin: AddressOrigin, vintages, interactive) -> Optional[GeocodeResult]:
    while True:
        geo = geocode_address(fetcher, address, vintages)
        if not geo.ok:
            say(f"  Geocoder: {geo.error}")
            if not interactive:
                return geo
            typed = ask("  Type a corrected address (Enter to skip this location): ")
            if not typed:
                return geo
            address, origin.detail = typed, origin.detail + "; corrected by the user"
            origin.confirmed, origin.confirmation_note = True, "corrected by the user at the prompt"
            continue
        say(f"  Census geocoder matched: {geo.matched_address}  ({geo.lat:.6f}, {geo.lon:.6f})")
        for w in geo.warnings:
            say(f"  note: {w}")
        if interactive:
            ans = ask("  Is that the right location? [Y/n] ").lower()
            if ans in ("n", "no"):
                typed = ask("  Type the correct address (Enter to keep this one): ")
                if typed:
                    address, origin.detail = typed, origin.detail + "; corrected by the user"
                    origin.confirmed, origin.confirmation_note = True, "corrected by the user at the prompt"
                    continue
            else:
                origin.confirmed = True
                origin.confirmation_note = (origin.confirmation_note + "; geocoder match confirmed").lstrip("; ")
        elif origin.kind == "user":
            # Typed by the user; treat as confirmed only if the geocoder agrees on house number and ZIP.
            a, m = _house_and_zip(address), _house_and_zip(geo.matched_address or "")
            origin.confirmed = a == m and a[0] is not None
            origin.confirmation_note = ("typed by the user; geocoder match agrees on house number and ZIP"
                                        if origin.confirmed else
                                        "typed by the user, but the geocoder match differs; check it")
        return geo


def state_programs(conn, state_abbr: Optional[str]) -> List[dict]:
    if not state_abbr:
        return []
    rows = [dict(r) for r in conn.execute("SELECT * FROM state_incentives WHERE state=?", (state_abbr,))]
    rank = {t: i for i, t in enumerate(PROGRAM_ORDER)}
    return sorted(rows, key=lambda r: (rank.get(r["program_type"], 99), r["program_name"]))


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--website", help="company website URL")
    ap.add_argument("--address", action="append", help="street address (repeat for several locations)")
    ap.add_argument("--name", help="company name (used as the report label)")
    ap.add_argument("--latlon", help="'lat,lon' to screen a point directly")
    ap.add_argument("--yes", action="store_true", help="do not prompt; accept the addresses found")
    ap.add_argument("--offline", action="store_true", help="use cached answers only")
    ap.add_argument("--no-hubzone", action="store_true", help="skip the live SBA HUBZone lookup")
    ap.add_argument("--no-html", action="store_true", help="console summary only")
    ap.add_argument("--out", type=Path, default=REPORTS_DIR, help="report folder (default reports/)")
    ap.add_argument("--max-locations", type=int, default=10, help="most locations to qualify from one website")
    ap.add_argument("--today", help="evaluate designation periods as of this date (YYYY-MM-DD)")
    ap.add_argument("--serve", nargs="?", const=8765, type=int, metavar="PORT",
                    help="run a local web form (default port 8765) instead of a one-off check")
    args = ap.parse_args(argv)

    if args.serve:
        from ozq.webform import serve
        serve(args.serve, args.out)
        return 0

    if not (args.website or args.address or args.latlon):
        if args.name:
            say(NAME_ONLY_MSG.format(name=args.name))
            return 2
        ap.print_help()
        return 2

    conn = db.connect()
    if not db.datasets(conn, "QOZ"):
        say("No Opportunity Zone list is loaded. Run:  python build_data.py")
        return 1
    manifest = load_manifest()
    vintages = required_geocoder_vintages(manifest)
    hub_src = next((d for d in manifest if d.get("method") == "sba_map_point_lookup"), None)
    today = dt.date.fromisoformat(args.today) if args.today else dt.date.today()
    fetcher = Fetcher(offline=args.offline)
    interactive = sys.stdin.isatty() and sys.stdout.isatty() and not args.yes
    company = args.name or (urlparse(args.website if "://" in (args.website or "") else f"https://{args.website}").netloc
                            if args.website else "Manual address")

    targets: List[Tuple[object, AddressOrigin]] = []
    if args.website:
        targets += choose_from_website(args, fetcher, interactive)
    for a in args.address or []:
        targets.append((a, AddressOrigin("user", "typed with --address")))
    if args.latlon:
        try:
            lat, lon = (float(x) for x in args.latlon.split(","))
        except ValueError:
            say("--latlon must look like 41.5033,-81.6229")
            return 2
        targets.append(((lat, lon), AddressOrigin("coordinates", "coordinates given with --latlon", confirmed=True,
                                                 confirmation_note="coordinates supplied by the user")))
    if not targets:
        say("\nNo address to screen. Re-run with --address \"street, city, ST ZIP\".")
        return 3

    reports, failed = [], 0
    for i, (target, origin) in enumerate(targets, 1):
        say(f"\n[{i}/{len(targets)}] {target if isinstance(target, str) else 'point %s,%s' % target}")
        if isinstance(target, tuple):
            geo = geocode_point(fetcher, target[0], target[1], vintages, label=args.latlon)
        else:
            geo = geocode_with_confirmation(fetcher, target, origin, vintages, interactive)
        if geo is None or not geo.ok:
            failed += 1
            continue
        results = evaluate_tract_datasets(conn, geo, today)
        hz = None
        if hub_src and not args.no_hubzone:
            hz = hubzone_lookup(fetcher, geo.lat, geo.lon, hub_src.get("endpoint"), hub_src.get("cache_days", 30))
        rep = LocationReport(company=company, origin=origin, geo=geo, results=results,
                             verdict=qoz_verdict(results), hubzone=hz, hubzone_source=hub_src,
                             state_programs=state_programs(conn, geo.state_abbr), today=today,
                             location_index=i, location_count=len(targets))
        say("")
        say(render_console(rep))
        if not args.no_html:
            path = write_html(rep, args.out)
            say(f"HTML report: {path}")
        reports.append(rep)

    if len(reports) > 1:
        say("\nSummary")
        for rep in reports:
            rounds = ", ".join(r.round_label for r in rep.verdict.rounds_yes) or "-"
            say(f"  {rep.verdict.answer:7} {rep.address_used}   [{rounds}]")
    if failed:
        say(f"\n{failed} location(s) could not be geocoded; no report was written for them.")
    return 0 if reports else 3


if __name__ == "__main__":
    sys.exit(main())
