"""A small local web form around the same pipeline as the command line.

    python qualify.py --serve            # then open http://127.0.0.1:8765

It listens on 127.0.0.1 only (your own computer), takes an address, several addresses
or a website, and writes the same one-page reports to reports/. Nothing is hosted.
"""

from __future__ import annotations

import datetime as dt
import html
import re
import webbrowser
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from typing import List, Optional, Tuple
from urllib.parse import parse_qs, quote, urlparse

from . import db
from .extract import INCLUDE_THRESHOLD, extract_from_website
from .geocode import geocode_address
from .hubzone import lookup as hubzone_lookup
from .manifest import load_manifest, required_geocoder_vintages
from .net import Fetcher
from .report import DISCLAIMER, AddressOrigin, LocationReport, write_html
from .verdict import evaluate_tract_datasets, qoz_verdict

STYLE = """
:root{--bg:#f4f6f8;--card:#fff;--ink:#17212b;--muted:#5a6775;--line:#d9dfe6;--accent:#1f5f8b;--yes:#0d6b4e;--yes-bg:#e3f2ec;
--no:#4a5562;--no-bg:#eaedf1;--unk:#87590a;--unk-bg:#fbf0d9}
@media (prefers-color-scheme:dark){:root{--bg:#11161c;--card:#18202a;--ink:#e4e9ef;--muted:#98a5b3;--line:#2a3542;--accent:#7fb6e0;
--yes:#63d2a6;--yes-bg:#133128;--no:#c0c9d3;--no-bg:#222b36;--unk:#f0c36a;--unk-bg:#2f2716;color-scheme:dark}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 -apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:760px;margin:0 auto;padding:28px 16px 48px;display:flex;flex-direction:column;gap:18px}
h1{font-size:26px;margin:0}p{margin:0}.muted{color:var(--muted)}.small{font-size:13px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px;display:flex;flex-direction:column;gap:10px}
label{font-weight:600}input,textarea{font:inherit;padding:10px 12px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--ink);width:100%}
textarea{min-height:84px}button{font:600 15px/1 inherit;padding:12px 18px;border:0;border-radius:8px;background:var(--accent);color:#fff;cursor:pointer;align-self:flex-start}
a{color:var(--accent)}.row{display:flex;gap:12px;align-items:flex-start}.badge{font-weight:700;padding:6px 10px;border-radius:8px;min-width:58px;text-align:center}
.YES{background:var(--yes-bg);color:var(--yes)}.NO{background:var(--no-bg);color:var(--no)}.UNKNOWN,.ERR{background:var(--unk-bg);color:var(--unk)}
"""


def _page(title: str, body: str) -> bytes:
    return (f"<!doctype html><html lang='en'><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'>"
            f"<title>{html.escape(title)}</title><style>{STYLE}</style></head><body><main>{body}"
            f"<p class='small muted'>{html.escape(DISCLAIMER)}</p></main></body></html>").encode("utf-8")


FORM = """<h1>OZ Qualifier</h1>
<p class="muted">Screens a location against the 2018 and 2027 Opportunity Zone lists, NMTC low-income tracts, HUBZone status
and seeded state programs. Each location gets a one-page report.</p>
<form class="card" action="/check" method="get">
  <label for="address">Street address <span class="muted small">(one per line for several locations)</span></label>
  <textarea id="address" name="address" placeholder="2516 Market Ave, Cleveland, OH 44113"></textarea>
  <label for="website">or company website</label>
  <input id="website" name="website" placeholder="https://www.example.com">
  <label for="name">Company name <span class="muted small">(optional label)</span></label>
  <input id="name" name="name" placeholder="Example Co">
  <button type="submit">Check</button>
  <p class="small muted">Website searches read the homepage plus contact, locations and about pages, and can take up to a minute.</p>
</form>"""


def _house_and_zip(s: str) -> Tuple[Optional[str], Optional[str]]:
    num = re.match(r"\s*(\d+)", s or "")
    z = re.findall(r"\b(\d{5})(?:-\d{4})?\b", s or "")
    return (num.group(1) if num else None, z[-1] if z else None)


def run_checks(name: str, addresses: List[str], website: str, out_dir: Path) -> str:
    conn = db.connect()
    if not db.datasets(conn, "QOZ"):
        return "<div class='card'><p>No Opportunity Zone list is loaded. Run <code>python build_data.py</code> first.</p></div>"
    manifest = load_manifest()
    vintages = required_geocoder_vintages(manifest)
    hub_src = next((d for d in manifest if d.get("method") == "sba_map_point_lookup"), None)
    fetcher = Fetcher()
    today = dt.date.today()
    company = name or (urlparse(website if "://" in website else f"https://{website}").netloc if website else "Manual address")
    parts: List[str] = []
    targets: List[Tuple[str, AddressOrigin]] = [(a, AddressOrigin("user", "typed in the web form")) for a in addresses]
    if website:
        ex = extract_from_website(fetcher, website)
        found = "".join(f"<li>{html.escape(c.one_line)} <span class='muted small'>(confidence {c.score:.2f})</span></li>"
                        for c in ex.candidates) or "<li>none</li>"
        notes = "".join(f"<p class='small muted'>{html.escape(n)}</p>" for n in ex.notes)
        parts.append(f"<div class='card'><p><b>Addresses found on {html.escape(website)}</b></p><ul>{found}</ul>{notes}"
                     f"<p class='small muted'>Locations at confidence {INCLUDE_THRESHOLD:.2f} or higher are screened below. "
                     "If one is wrong, type the right address instead.</p></div>")
        picks = ex.locations or ex.candidates[:1]
        for c in picks:
            b = c.best_source
            targets.append((c.one_line, AddressOrigin("website", f"{b.region} of {b.page_type} page", url=b.url,
                                                      confirmed=False, confirmation_note="found on the website; check it")))
    if not targets:
        return "<div class='card'><p>Enter an address or a website.</p></div>"
    for i, (addr, origin) in enumerate(targets, 1):
        geo = geocode_address(fetcher, addr, vintages)
        if not geo.ok:
            parts.append(f"<div class='card row'><span class='badge ERR'>?</span><div><p><b>{html.escape(addr)}</b></p>"
                         f"<p class='small'>{html.escape(geo.error or 'not found')}</p></div></div>")
            continue
        if origin.kind == "user":
            a, m = _house_and_zip(addr), _house_and_zip(geo.matched_address or "")
            origin.confirmed = a == m and a[0] is not None
            origin.confirmation_note = ("typed by the user; geocoder match agrees on house number and ZIP"
                                        if origin.confirmed else "typed by the user, but the geocoder match differs; check it")
        results = evaluate_tract_datasets(conn, geo, today)
        hz = hubzone_lookup(fetcher, geo.lat, geo.lon, hub_src.get("endpoint"), hub_src.get("cache_days", 30)) if hub_src else None
        programs = [dict(r) for r in conn.execute("SELECT * FROM state_incentives WHERE state=?", (geo.state_abbr,))]
        rep = LocationReport(company=company, origin=origin, geo=geo, results=results, verdict=qoz_verdict(results),
                             hubzone=hz, hubzone_source=hub_src, state_programs=programs, today=today,
                             location_index=i, location_count=len(targets))
        path = write_html(rep, out_dir)
        v = rep.verdict
        parts.append(f"<div class='card row'><span class='badge {v.answer}'>{v.answer}</span><div>"
                     f"<p><b>{html.escape(rep.address_used)}</b></p><p class='small'>{html.escape(v.summary)}</p>"
                     f"<p class='small'><a href='/reports/{quote(path.name)}'>Open the full report</a></p></div></div>")
    return "".join(parts)


def serve(port: int, out_dir: Path) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)

    class Handler(BaseHTTPRequestHandler):
        def _send(self, body: bytes, status: int = 200, ctype: str = "text/html; charset=utf-8"):
            self.send_response(status)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):  # noqa: N802
            u = urlparse(self.path)
            if u.path == "/":
                return self._send(_page("OZ Qualifier", FORM))
            if u.path == "/check":
                qs = parse_qs(u.query)
                addresses = [a.strip() for a in (qs.get("address", [""])[0]).splitlines() if a.strip()]
                body = run_checks(qs.get("name", [""])[0].strip(), addresses, qs.get("website", [""])[0].strip(), out_dir)
                return self._send(_page("OZ Qualifier results", "<h1>Results</h1><p><a href='/'>New check</a></p>" + body))
            m = re.fullmatch(r"/reports/([A-Za-z0-9._-]+\.html)", u.path)
            if m and (out_dir / m.group(1)).is_file():
                return self._send((out_dir / m.group(1)).read_bytes())
            return self._send(_page("Not found", "<p>Not found. <a href='/'>Start over</a></p>"), 404)

        def log_message(self, fmt, *args):  # keep the terminal quiet
            pass

    server = HTTPServer(("127.0.0.1", port), Handler)
    url = f"http://127.0.0.1:{port}/"
    print(f"OZ Qualifier web form running at {url}  (Ctrl+C to stop)")
    try:
        webbrowser.open(url)
    except Exception:
        pass
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nstopped")
