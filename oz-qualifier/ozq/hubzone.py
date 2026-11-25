"""HUBZone status from SBA's official HUBZone map (maps.certify.sba.gov/hubzone/map).

SBA publishes no current bulk file of HUBZone areas (the data.gov tract files stop at
2018 and were superseded by the July 1, 2023 redesignation). The tool therefore asks the
same endpoint the public SBA map calls when you click a point, and caches the answer
(30 days by default; the cached query date is printed in the report). One point lookup
covers every HUBZone type the map shows: qualified census tracts, non-metro counties,
Indian lands, base closure areas, governor-designated areas, disaster areas, and
redesignated areas with their expiration dates.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from typing import List, Optional

from bs4 import BeautifulSoup

from .net import FetchError, Fetcher

DEFAULT_ENDPOINT = "https://maps.certify.sba.gov/hubzone/map/search"

LAYER_LABELS = {
    "qct_e": "Qualified census tract",
    "qct_r": "Redesignated census tract",
    "qct_qda": "Census tract (qualified disaster area)",
    "qct_brac": "Census tract (base closure area)",
    "qnmc_e": "Qualified non-metropolitan county",
    "qnmc_ab": "Qualified non-metropolitan county",
    "qnmc_a": "Qualified non-metropolitan county",
    "qnmc_b": "Qualified non-metropolitan county",
    "qnmc_c": "Qualified non-metropolitan county",
    "qnmc_r": "Redesignated non-metropolitan county",
    "qnmc_qda": "Non-metropolitan county (qualified disaster area)",
    "qnmc_brac": "Non-metropolitan county (base closure area)",
    "indian_lands": "Indian lands",
    "brac": "Base closure area",
    "gov": "Governor-designated area",
}


@dataclass
class HubzoneDesignation:
    layer: str
    label: str
    details: dict = field(default_factory=dict)


@dataclass
class HubzoneResult:
    status: str                          # QUALIFIED | NOT QUALIFIED | UNKNOWN
    status_text: Optional[str] = None
    until: Optional[str] = None          # expiration text for redesignated areas
    designations: List[HubzoneDesignation] = field(default_factory=list)
    valid_as_of: Optional[str] = None    # SBA's own "Qualification Valid as of" text
    queried_at: Optional[str] = None
    from_cache: bool = False
    stale: bool = False
    error: Optional[str] = None
    notes: List[str] = field(default_factory=list)


def _embedded_json(text: str) -> Optional[dict]:
    """The map's reply embeds the structured API answer as  var response = JSON.parse('...');"""
    m = re.search(r"var response = JSON\.parse\('(.*?)'\);", text, re.S)
    if not m:
        return None
    raw = m.group(1)
    for candidate in (raw, re.sub(r"\\(['\\/])", r"\1", raw)):
        try:
            return json.loads(candidate)
        except ValueError:
            continue
    return None


def _designation_from_json(item: dict) -> HubzoneDesignation:
    layer = item.get("hz_type") or ""
    label = LAYER_LABELS.get(layer, layer.replace("_", " ") or "HUBZone area")
    details = {}
    for key, name in (("tract_fips", "Tract"), ("county_fips", "County FIPS"), ("county", "County"),
                      ("name", "Name"), ("type", "Type"), ("effective", "Effective"), ("expires", "Expires")):
        if item.get(key):
            details[name] = str(item[key])
    if item.get("redesignated"):
        details["Redesignated"] = "yes"
    return HubzoneDesignation(layer=layer, label=label, details=details)


def parse_response(text: str) -> HubzoneResult:
    blocks = re.findall(r"\.html\((\".*?\")\);", text, re.S)
    html = "".join(json.loads(b) for b in blocks) if blocks else text
    soup = BeautifulSoup(html, "lxml")
    st = soup.find(id="hubzone-status")
    if st is None:
        return HubzoneResult(status="UNKNOWN", error="unrecognized response from the SBA HUBZone map")
    label = (st.get("aria-label") or st.get_text(" ", strip=True)).strip()
    low = label.lower()
    status = "NOT QUALIFIED" if ("not" in low or "non" in low) else ("QUALIFIED" if "qualified" in low else "UNKNOWN")
    res = HubzoneResult(status=status, status_text=st.get_text(" ", strip=True))
    until = soup.find(class_="hubzone-until-date")
    if until and until.get_text(strip=True):
        res.until = until.get_text(" ", strip=True)

    data = _embedded_json(text)
    if data and isinstance(data.get("hubzone"), list):
        res.designations = [_designation_from_json(i) for i in data["hubzone"] if isinstance(i, dict)]
        if data.get("until_date") and not res.until:
            res.until = str(data["until_date"])
    else:  # fall back to the rendered sidebar
        for row in soup.find_all(class_="designation-row"):
            layer = row.get("id") or ""
            lab = row.find(class_="qualification-label")
            d = HubzoneDesignation(layer=layer, label=LAYER_LABELS.get(layer, lab.get_text(" ", strip=True) if lab else layer))
            details = row.find_next_sibling(class_="designation")
            if details:
                for item in details.find_all(class_="designation-details-item"):
                    k, v = item.find("h6"), item.find("h5")
                    if k and v:
                        d.details[k.get_text(" ", strip=True)] = v.get_text(" ", strip=True)
            res.designations.append(d)
    txt = soup.get_text(" ", strip=True)
    m = re.search(r"(SBA will not update[^.]*?(?:20\d\d))", txt)
    if m:
        res.notes.append(m.group(1))
    return res


def lookup(fetcher: Fetcher, lat: float, lon: float, endpoint: str = DEFAULT_ENDPOINT,
           cache_days: float = 30) -> HubzoneResult:
    params = {"latlng": f"{lat:.6f},{lon:.6f}", "locale": "en"}
    headers = {"Accept": "*/*", "X-Requested-With": "XMLHttpRequest"}
    try:
        resp = fetcher.get(endpoint, params=params, headers=headers, max_age_days=cache_days)
    except FetchError as exc:
        return HubzoneResult(status="UNKNOWN", error=f"SBA HUBZone map unavailable ({exc})")
    if not resp.ok:
        return HubzoneResult(status="UNKNOWN", error=f"SBA HUBZone map returned HTTP {resp.status}")
    res = parse_response(resp.text)
    res.queried_at, res.from_cache, res.stale = resp.fetched_at_iso, resp.from_cache, resp.stale
    if resp.stale:
        res.notes.append("Offline: this is an older cached answer; re-run online to refresh.")
    return res
