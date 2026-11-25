"""One-page screening report per location: console summary and an HTML file."""

from __future__ import annotations

import datetime as dt
import html
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import List, Optional
from urllib.parse import quote_plus

from . import __version__
from .geocode import MISMATCH_FLAG, GeocodeResult
from .hubzone import HubzoneResult
from .verdict import DesignationResult, QozVerdict, _fmt

DISCLAIMER = ("This is a screening tool. It is not tax, legal, or investment advice, and any Opportunity Zone "
              "structure must be confirmed with qualified counsel and against the CDFI Fund's official records "
              "before reliance.")

HUD_OZ_MAP = "https://www.huduser.gov/opportunityzones/"


@dataclass
class AddressOrigin:
    kind: str                       # website | user | coordinates
    detail: str                     # e.g. "contact page body" or "typed with --address"
    url: Optional[str] = None
    confirmed: bool = False         # a person confirmed the address the verdict uses
    confirmation_note: str = ""


@dataclass
class LocationReport:
    company: str
    origin: AddressOrigin
    geo: GeocodeResult
    results: List[DesignationResult]
    verdict: QozVerdict
    hubzone: Optional[HubzoneResult]
    hubzone_source: Optional[dict]
    state_programs: List[dict]
    today: dt.date
    location_index: int = 1
    location_count: int = 1
    extra_warnings: List[str] = field(default_factory=list)

    @property
    def address_used(self) -> str:
        return self.geo.matched_address or self.geo.input_address

    def by_program(self, program: str) -> List[DesignationResult]:
        return [r for r in self.results if r.program == program]

    @property
    def warnings(self) -> List[str]:
        w = list(self.extra_warnings) + list(self.geo.warnings)
        for r in self.results:
            if r.vintage_mismatch:
                w.append(f"{r.round_label}: {MISMATCH_FLAG} (asked for {r.geocoder_vintage}, got {r.vintage_used}).")
            if r.alias_note:
                w.append(f"{r.round_label}: {r.alias_note}.")
            if r.problem:
                w.append(f"{r.round_label}: {r.problem}.")
            if r.is_sample:
                w.append(f"{r.name}: SAMPLE DATA loaded, not the official list. Run build_data.py.")
        if not self.origin.confirmed:
            w.append("Address not confirmed by a person. The verdict is provisional until someone checks the address above.")
        return w

    @property
    def uses_sample(self) -> bool:
        return any(r.is_sample for r in self.results)


# ---------------------------------------------------------------- helpers

def _yn(v: Optional[bool]) -> str:
    return "YES" if v else ("NO" if v is False else "UNKNOWN")


def _period(r: DesignationResult) -> str:
    if not r.effective_date and not r.expires_date:
        return "-"
    status = {"in_effect": "in effect", "not_yet_effective": "not yet in effect", "expired": "expired"}.get(
        r.period_status or "", "")
    end = _fmt(r.expires_date) if r.expires_date else "no end date"
    return f"{_fmt(r.effective_date)} to {end} ({status})"


def _nmtc_stats(r: DesignationResult) -> str:
    e = r.extra or {}
    bits = []
    if isinstance(e.get("poverty_rate_pct"), (int, float)):
        bits.append(f"poverty {e['poverty_rate_pct']:.1f}%")
    if isinstance(e.get("mfi_ratio_to_benchmark"), (int, float)):
        bits.append(f"median family income {e['mfi_ratio_to_benchmark'] * 100:.0f}% of benchmark")
    if isinstance(e.get("unemployment_rate_pct"), (int, float)):
        bits.append(f"unemployment {e['unemployment_rate_pct']:.1f}%")
    if e.get("metro_status"):
        bits.append(str(e["metro_status"]).lower())
    if r.flags.get("high_migration_rural"):
        bits.append("high-migration rural county tract")
    return ", ".join(bits)


def map_links(rep: LocationReport) -> List[tuple]:
    g = rep.geo
    links = []
    if g.ok:
        links.append(("Google Maps (geocoded point)",
                      f"https://www.google.com/maps/search/?api=1&query={g.lat:.6f}%2C{g.lon:.6f}"))
    elif rep.address_used:
        links.append(("Google Maps", f"https://www.google.com/maps/search/?api=1&query={quote_plus(rep.address_used)}"))
    for r in rep.by_program("QOZ"):
        if r.map_url:
            links.append((r.map_label or f"CDFI Fund map ({r.round_label})", r.map_url))
    links.append(("HUD Opportunity Zones Activity Map (search the address)", HUD_OZ_MAP))
    if rep.hubzone_source and rep.hubzone_source.get("map_url_template") and g.ok:
        links.append((rep.hubzone_source.get("map_label") or "SBA HUBZone map",
                      rep.hubzone_source["map_url_template"].format(lat=f"{g.lat:.6f}", lon=f"{g.lon:.6f}")))
    seen, out = set(), []
    for label, url in links:
        if url not in seen:
            seen.add(url)
            out.append((label, url))
    return out


def checklist(rep: LocationReport) -> List[str]:
    """General information shown only when the QOZ verdict is YES."""
    rural = any(r.flags.get("rural") for r in rep.verdict.rounds_yes)
    items = [
        "The investment must come through a Qualified Opportunity Fund (QOF): a corporation or partnership "
        "that self-certifies on IRS Form 8996 and holds at least 90% of its assets in qualified opportunity zone property.",
        "The business must be a Qualified Opportunity Zone Business. That includes the test that at least 70 percent "
        "of its tangible property is qualified opportunity zone business property, plus the other QOZB tests "
        "(at least 50% of gross income from active business in the zone, a substantial portion of intangible "
        "property used there, limits on nonqualified financial property, and no excluded \"sin\" businesses).",
        "Existing buildings generally need substantial improvement, roughly doubling the basis of the building "
        "(not the land) within 30 months.",
        "The working capital safe harbor can protect cash held under a written plan for up to 31 months.",
        "Being in the tract is necessary and nowhere near sufficient. The fund, the business, the property and "
        "the timing all have to qualify.",
    ]
    if rural:
        items.insert(3, "This tract is flagged as comprised entirely of a rural area. For rural QOZs the "
                        "substantial-improvement threshold is 50% of basis instead of 100% (Pub. L. 119-21; "
                        "IRS Notice 2025-50).")
    ids = {r.dataset_id for r in rep.verdict.rounds_yes}
    qoz = rep.by_program("QOZ")
    only_old = [r for r in rep.verdict.rounds_yes if r.period_status == "in_effect"]
    future = [r for r in rep.verdict.rounds_yes if r.period_status == "not_yet_effective"]
    later = [r for r in qoz if r.dataset_id not in ids and r.period_status == "not_yet_effective"]
    if only_old and later:
        items.append(f"Timing: this tract's {only_old[0].round_label} designation ends {_fmt(only_old[0].expires_date)} "
                     f"and the tract is not in the {later[0].round_label}. Have counsel confirm how that affects "
                     "any investment timeline.")
    if future and not only_old:
        items.append(f"Timing: the {future[0].round_label} designation takes effect {_fmt(future[0].effective_date)}; "
                     "the tract is not a designated zone before then.")
    return items


# ---------------------------------------------------------------- console

def render_console(rep: LocationReport) -> str:
    g, v = rep.geo, rep.verdict
    out = []
    head = f"{rep.company}"
    if rep.location_count > 1:
        head += f"  (location {rep.location_index} of {rep.location_count})"
    out.append("=" * 78)
    out.append(head)
    if rep.uses_sample:
        out.append("!! SAMPLE DATA: one or more official lists are not loaded. Not for reliance.")
    out.append("-" * 78)
    flag = "  [UNVERIFIED: see warnings]" if v.unverified else ""
    out.append(f"Located in a designated Qualified Opportunity Zone: {v.answer}{flag}")
    out.append(f"  {v.summary}")
    out.append(f"  Address used : {rep.address_used}")
    if g.matched_address and g.input_address and g.matched_address.lower() != g.input_address.lower():
        out.append(f"  (input was   : {g.input_address})")
    out.append(f"  Source       : {rep.origin.detail}" + (f"  {rep.origin.url}" if rep.origin.url else ""))
    out.append(f"  Confirmed    : {'yes' if rep.origin.confirmed else 'NO'}"
               + (f" ({rep.origin.confirmation_note})" if rep.origin.confirmation_note else ""))
    out.append(f"  County/State : {g.county_name or '?'}, {g.state_abbr or '?'}"
               + (f"   Coordinates: {g.lat:.6f}, {g.lon:.6f}" if g.ok else ""))
    for r in rep.by_program("QOZ"):
        out.append(f"  {r.round_label:11}: {_yn(r.qualifies):3}  tract {r.geoid_matched or r.geoid_used or '?'}"
                   f" ({r.tract_vintage} tracts)  {_period(r)}"
                   + (f"  [{r.category}]" if r.qualifies and r.category else ""))
    out.append("Other designations")
    for r in rep.by_program("NMTC"):
        out.append(f"  NMTC low-income community: {_yn(r.qualifies)}  tract {r.geoid_used or '?'}  "
                   f"({r.round_label}, {r.vintage_date})")
        stats = _nmtc_stats(r)
        if stats:
            out.append(f"    {stats}")
    for r in rep.by_program("HUBZONE"):
        out.append(f"  HUBZone (tract file): {_yn(r.qualifies)}  tract {r.geoid_used}  ({r.vintage_date or 'no date'})")
    h = rep.hubzone
    if h is not None:
        when = h.queried_at or "?"
        out.append(f"  HUBZone (SBA map): {h.status}  as of {when}" + ("  [cached]" if h.from_cache else "")
                   + (f"  {h.until}" if h.until else ""))
        for d in h.designations:
            det = ", ".join(f"{k} {v}" for k, v in d.details.items())
            out.append(f"    - {d.label}" + (f": {det}" if det else ""))
        if h.error:
            out.append(f"    {h.error}")
    out.append(f"State programs ({g.state_abbr or '?'}), hand-maintained starting point")
    if rep.state_programs:
        for p in rep.state_programs:
            out.append(f"  - {p['program_name']} [{p['program_type']}], as of {p['as_of']}")
    else:
        out.append(f"  none seeded for {g.state_abbr or 'this state'} (add rows to data/state_incentives.csv)")
    if rep.warnings:
        out.append("Warnings")
        for w in rep.warnings:
            out.append(f"  ! {w}")
    out.append(DISCLAIMER)
    return "\n".join(out)


# ---------------------------------------------------------------- HTML

CSS = """
:root{--bg:#fff;--fg:#1c2430;--muted:#5d6878;--line:#dde2ea;--card:#f6f8fb;--yes:#0b6e4f;--yes-bg:#e6f4ee;
--no:#46505e;--no-bg:#eef0f4;--unk:#8a5a00;--unk-bg:#fff4dc;--warn:#8a3b00;--warn-bg:#fff1e6;--link:#1d5bbf}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#12161c;--fg:#e6e9ef;--muted:#9aa4b2;--line:#2a313b;--card:#1a1f27;
--yes:#5fd3a6;--yes-bg:#12302a;--no:#c3cad4;--no-bg:#22272f;--unk:#f2c46b;--unk-bg:#2e2615;--warn:#ffb27a;--warn-bg:#2e2016;--link:#8ab4ff;color-scheme:dark}}
:root[data-theme="dark"]{--bg:#12161c;--fg:#e6e9ef;--muted:#9aa4b2;--line:#2a313b;--card:#1a1f27;
--yes:#5fd3a6;--yes-bg:#12302a;--no:#c3cad4;--no-bg:#22272f;--unk:#f2c46b;--unk-bg:#2e2615;--warn:#ffb27a;--warn-bg:#2e2016;--link:#8ab4ff;color-scheme:dark}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
main{max-width:880px;margin:0 auto;padding:24px 16px 40px}
a{color:var(--link)}h1{font-size:15px;font-weight:600;margin:0;color:var(--muted);letter-spacing:.02em}
h2{font-size:13px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin:22px 0 8px;font-weight:600}
.verdict{border-radius:10px;padding:16px 18px;margin:10px 0 6px;border:1px solid var(--line)}
.verdict .q{font-size:15px;margin:0}.verdict .a{font-size:30px;font-weight:700;margin:2px 0 4px;letter-spacing:.01em}
.YES{background:var(--yes-bg)}.YES .a{color:var(--yes)}.NO{background:var(--no-bg)}.NO .a{color:var(--no)}
.UNKNOWN{background:var(--unk-bg)}.UNKNOWN .a{color:var(--unk)}
.tag{display:inline-block;font-size:11px;font-weight:600;padding:2px 7px;border-radius:999px;margin-left:8px;vertical-align:middle;background:var(--warn-bg);color:var(--warn)}
dl.facts{display:grid;grid-template-columns:max-content 1fr;gap:3px 14px;margin:10px 0 0}dl.facts dt{color:var(--muted)}dl.facts dd{margin:0;overflow-wrap:anywhere}
table{width:100%;border-collapse:collapse;font-size:13px}th,td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--line);vertical-align:top}
th{color:var(--muted);font-weight:600;font-size:12px}td.y{color:var(--yes);font-weight:700}td.n{color:var(--no);font-weight:700}td.u{color:var(--unk);font-weight:700}
.scroll{overflow-x:auto}.nw{white-space:nowrap}ul{margin:6px 0;padding-left:20px}li{margin:3px 0}
.box{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:12px 14px}
.warn{background:var(--warn-bg);border:1px solid var(--line);border-radius:8px;padding:10px 14px;color:var(--warn)}
.small{font-size:12px;color:var(--muted)}.disclaimer{font-weight:600;margin-top:10px}
.checklist li::marker{content:"\\2610  "}
@media print{body{font-size:11px}main{padding:0}.verdict .a{font-size:24px}h2{margin-top:14px}a{color:inherit;text-decoration:none}}
"""


def _e(s) -> str:
    return html.escape("" if s is None else str(s))


def _cls(v: Optional[bool]) -> str:
    return "y" if v else ("n" if v is False else "u")


def render_html(rep: LocationReport) -> str:
    g, v = rep.geo, rep.verdict
    title = f"OZ screen: {rep.company}"
    parts = [f"<!doctype html><html lang='en'><head><meta charset='utf-8'>"
             f"<meta name='viewport' content='width=device-width,initial-scale=1'>"
             f"<title>{_e(title)}</title><style>{CSS}</style></head><body><main>"]
    loc = f" &middot; location {rep.location_index} of {rep.location_count}" if rep.location_count > 1 else ""
    parts.append(f"<h1>{_e(rep.company)}{loc} &middot; screened {_e(rep.today.isoformat())}</h1>")
    if rep.uses_sample:
        parts.append("<p class='warn'><b>SAMPLE DATA.</b> One or more official designation lists are not loaded; "
                     "this report uses a small test sample and must not be relied on. Run <code>python build_data.py</code>.</p>")

    # 1. verdict header
    tags = ""
    if v.unverified:
        tags += "<span class='tag'>unverified, see warnings</span>"
    if not rep.origin.confirmed:
        tags += "<span class='tag'>address not confirmed</span>"
    tract_lines = "<br>".join(
        f"{_e(r.geoid_matched or r.geoid_used or '?')} <span class='small'>({_e(r.tract_vintage)} tracts, {_e(r.round_label)})</span>"
        for r in rep.by_program("QOZ")) or "?"
    parts.append(f"<section class='verdict {v.answer}'><p class='q'>Located in a designated Qualified Opportunity Zone:{tags}</p>"
                 f"<p class='a'>{v.answer}</p><p>{_e(v.summary)}</p>"
                 "<dl class='facts'>"
                 f"<dt>Address used</dt><dd><b>{_e(rep.address_used)}</b></dd>"
                 + (f"<dt>Input</dt><dd>{_e(g.input_address)}</dd>" if g.matched_address and g.input_address.lower() != g.matched_address.lower() else "")
                 + f"<dt>Tract GEOID</dt><dd>{tract_lines}</dd>"
                 f"<dt>County</dt><dd>{_e(g.county_name or '?')}</dd>"
                 f"<dt>State</dt><dd>{_e(g.state_name or g.state_abbr or '?')}</dd>"
                 + (f"<dt>Coordinates</dt><dd>{g.lat:.6f}, {g.lon:.6f}</dd>" if g.ok else "")
                 + f"<dt>Address source</dt><dd>{_e(rep.origin.detail)}"
                 + (f" &middot; <a href='{_e(rep.origin.url)}'>{_e(rep.origin.url)}</a>" if rep.origin.url else "")
                 + f"</dd><dt>Confirmed</dt><dd>{'Yes' if rep.origin.confirmed else '<b>No</b>'}"
                 + (f" ({_e(rep.origin.confirmation_note)})" if rep.origin.confirmation_note else "")
                 + "</dd></dl></section>")

    rows = []
    for r in rep.by_program("QOZ"):
        rows.append(f"<tr><td>{_e(r.round_label)}</td><td class='{_cls(r.qualifies)}'>{_yn(r.qualifies)}</td>"
                    f"<td>{_e(r.geoid_matched or r.geoid_used or '?')}<br><span class='small'>{_e(r.tract_vintage)} tracts via {_e(r.vintage_used or r.geocoder_vintage)}</span></td>"
                    f"<td>{_e(_period(r))}</td><td>{_e(r.category or '')}"
                    f"{' &middot; rural' if r.flags.get('rural') else ''}</td></tr>")
    parts.append("<div class='scroll'><table><thead><tr><th>Designation round</th><th>In tract list</th><th>Tract</th>"
                 "<th>Designation period</th><th>Category</th></tr></thead><tbody>" + "".join(rows) + "</tbody></table></div>")

    # 2. map links
    parts.append("<h2>Verify on a map</h2><ul>")
    for label, url in map_links(rep):
        parts.append(f"<li><a href='{_e(url)}' target='_blank' rel='noopener'>{_e(label)}</a></li>")
    parts.append("</ul>")

    # 3. other designations
    parts.append("<h2>Other designations</h2><div class='scroll'><table><thead><tr><th>Program</th><th>Status</th>"
                 "<th>Detail</th><th>Dataset vintage</th></tr></thead><tbody>")
    for r in rep.by_program("NMTC"):
        parts.append(f"<tr><td>NMTC low-income community</td><td class='{_cls(r.qualifies)}'>{_yn(r.qualifies)}</td>"
                     f"<td>Tract {_e(r.geoid_used or '?')} ({_e(r.tract_vintage)} tracts)"
                     f"{'<br><span class=small>' + _e(_nmtc_stats(r)) + '</span>' if _nmtc_stats(r) else ''}</td>"
                     f"<td>{_e(r.round_label)}, released {_e(r.vintage_date)}</td></tr>")
    for r in rep.by_program("HUBZONE"):
        parts.append(f"<tr><td>HUBZone (tract file)</td><td class='{_cls(r.qualifies)}'>{_yn(r.qualifies)}</td>"
                     f"<td>Tract {_e(r.geoid_used)}</td><td>{_e(r.vintage_date or '')}</td></tr>")
    h = rep.hubzone
    if h is not None:
        hz = {"QUALIFIED": True, "NOT QUALIFIED": False}.get(h.status)
        det = "".join(f"<br>{_e(d.label)}" + (": " + _e(", ".join(f"{k} {val}" for k, val in d.details.items())) if d.details else "")
                      for d in h.designations) or "<br>No HUBZone designation at this point."
        if h.until:
            det += f"<br>{_e(h.until)}"
        if h.error:
            det += f"<br>{_e(h.error)}"
        parts.append(f"<tr><td>HUBZone</td><td class='{_cls(hz)}'>{_e(h.status)}</td>"
                     f"<td>SBA HUBZone map, point lookup{det}</td>"
                     f"<td>Queried {_e(h.queried_at or '?')}{' (cached)' if h.from_cache else ''}"
                     f"{'<br>' + _e(h.notes[0]) if h.notes else ''}</td></tr>")
    parts.append("</tbody></table></div>")
    if rep.hubzone_source and rep.hubzone_source.get("period_note"):
        parts.append(f"<p class='small'>HUBZone coverage: {_e(rep.hubzone_source['period_note'])}</p>")

    # 4. state programs
    parts.append(f"<h2>State programs: {_e(g.state_name or g.state_abbr or '?')}</h2>")
    if rep.state_programs:
        parts.append("<p class='small'>Hand-maintained starting point for research, not a complete list. "
                     "Each row was last checked on its as-of date.</p><div class='scroll'><table><thead><tr><th>Program</th>"
                     "<th>What it is</th><th>As of</th></tr></thead><tbody>")
        for p in rep.state_programs:
            parts.append(f"<tr><td><a href='{_e(p['official_url'])}' target='_blank' rel='noopener'>{_e(p['program_name'])}</a>"
                         f"<br><span class='small'>{_e(p['program_type'].replace('_', ' '))}</span></td>"
                         f"<td>{_e(p['description'])}{'<br><span class=small>' + _e(p['notes']) + '</span>' if p.get('notes') else ''}</td>"
                         f"<td class='nw'>{_e(p['as_of'])}</td></tr>")
        parts.append("</tbody></table></div>")
    else:
        parts.append(f"<p>No programs are seeded for {_e(g.state_abbr or 'this state')}. Add rows to "
                     "<code>data/state_incentives.csv</code> (see README).</p>")

    # 5. checklist (YES only)
    if v.answer == "YES":
        parts.append("<h2>What QOZ status would actually require</h2><div class='box'>"
                     "<p class='small'><b>General information, not advice.</b> Checklist of the main federal rules; "
                     "counsel must confirm how they apply.</p><ul class='checklist'>")
        parts.extend(f"<li>{_e(item)}</li>" for item in checklist(rep))
        parts.append("</ul></div>")

    # warnings
    if rep.warnings:
        parts.append("<h2>Warnings</h2><div class='warn'><ul>")
        parts.extend(f"<li>{_e(w)}</li>" for w in rep.warnings)
        parts.append("</ul></div>")

    # 6. data and limits
    parts.append("<h2>Data and limits</h2><div class='box'><table><thead><tr><th>Dataset</th><th>Vintage</th>"
                 "<th>Tract vintage</th><th>Geocoder vintage used</th></tr></thead><tbody>")
    for r in rep.results:
        used = r.vintage_used or "-"
        if r.vintage_mismatch:
            used += f" (wanted {r.geocoder_vintage}: {MISMATCH_FLAG})"
        src = f" <a href='{_e(r.source_url)}'>source</a>" if r.source_url else ""
        parts.append(f"<tr><td>{_e(r.name)}{' <b>[SAMPLE]</b>' if r.is_sample else ''}{src}</td><td>{_e(r.vintage_date or '-')}</td>"
                     f"<td>{_e(r.tract_vintage or '-')}</td><td>{_e(used)}</td></tr>")
    if h is not None:
        parts.append(f"<tr><td>SBA HUBZone map (live)</td><td>queried {_e(h.queried_at or '?')}</td><td>-</td><td>-</td></tr>")
    parts.append(f"<tr><td>State incentives table (hand-maintained)</td><td>rows as of "
                 f"{_e(', '.join(sorted({p['as_of'] for p in rep.state_programs})) or '-')}</td><td>-</td><td>-</td></tr>")
    parts.append("</tbody></table>")
    parts.append(f"<p class='small'>Geocoder: US Census Bureau Geocoder, benchmark Public_AR_Current. Each list is "
                 f"matched with the vintage its tracts use. The geocoder places an address on a street segment, so "
                 f"addresses near a tract boundary should be checked on the map.</p>"
                 f"<p class='disclaimer'>{_e(DISCLAIMER)}</p>"
                 f"<p class='small'>oz-qualifier {__version__} &middot; generated {dt.datetime.now().strftime('%Y-%m-%d %H:%M')}</p>"
                 "</div></main></body></html>")
    return "".join(parts)


def slug(s: str, n: int = 48) -> str:
    s = re.sub(r"https?://", "", s or "").lower()
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    return s[:n].strip("-") or "report"


def write_html(rep: LocationReport, out_dir: Path) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    name = f"{slug(rep.company, 40)}--{slug(rep.address_used, 60)}.html"
    path = out_dir / name
    path.write_text(render_html(rep), encoding="utf-8")
    return path
